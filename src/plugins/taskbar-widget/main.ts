import path from 'node:path';
import fs from 'node:fs';

import { app, BrowserWindow, ipcMain, screen } from 'electron';

import { getSongControls } from '@/providers/song-controls';
import {
  registerCallback,
  type SongInfo,
  SongInfoEvent,
} from '@/providers/song-info';

// Widget width limits – the actual width is driven by the renderer content
// via the 'taskbar-widget:resize' IPC channel.
const MAX_WIDGET_WIDTH = 350;
const MIN_WIDGET_WIDTH = 150;
// Default taskbar height on Windows 11 (used as fallback)
const DEFAULT_TASKBAR_HEIGHT = 48;
// Estimated width of the system tray area (hidden icons arrow, pinned
// tray icons, clock, action center) so the widget sits to their left.
// A generous default keeps the widget clear of pinned tray icons.
// Windows 11 only supports the bottom taskbar position.
const SYSTEM_TRAY_ESTIMATED_WIDTH = 450;
// How often (ms) to re-check and reposition the widget + reassert z-order.
// Handles auto-hide taskbar changes and z-index loss from window focus changes.
const REPOSITION_INTERVAL_MS = 250;

let miniPlayerWin: BrowserWindow | null = null;
let controlHandler:
  | ((_: Electron.IpcMainEvent, command: string) => void)
  | null = null;
let resizeHandler: ((_: Electron.IpcMainEvent, width: number) => void) | null =
  null;
let displayChangeHandler: (() => void) | null = null;
let repositionTimer: ReturnType<typeof setInterval> | null = null;
let selectedMonitorIndex = 0;
let positionOffsetX = 0;
let positionOffsetY = 0;
let backgroundBlurEnabled = false;
let currentWidgetWidth = MIN_WIDGET_WIDTH;
// Tracks whether the widget is supposed to be visible (a song is playing).
// Used to decide whether to recover from external hides.
let isShowing = false;
// Set before intentional close to suppress auto-recovery.
let intentionalClose = false;
// Cache last bounds to avoid unnecessary setBounds calls that cause flicker.
let lastBounds: { x: number; y: number; width: number; height: number } | null =
  null;

const getWidgetDir = () => {
  const dir = path.join(app.getPath('userData'), 'taskbar-widget');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
};

const writePreloadScript = (): string => {
  const preloadPath = path.join(getWidgetDir(), 'preload.js');
  // Written at runtime because the plugin system doesn't support bundling
  // separate preload scripts for secondary windows
  fs.writeFileSync(
    preloadPath,
    `const { contextBridge, ipcRenderer } = require('electron');
const ALLOWED_SEND = ['taskbar-widget:control', 'taskbar-widget:resize'];
const ALLOWED_RECEIVE = ['taskbar-widget:song-info', 'taskbar-widget:set-blur'];
contextBridge.exposeInMainWorld('widgetIpc', {
  send: (channel, ...args) => {
    if (ALLOWED_SEND.includes(channel)) {
      ipcRenderer.send(channel, ...args);
    }
  },
  on: (channel, listener) => {
    if (ALLOWED_RECEIVE.includes(channel)) {
      ipcRenderer.on(channel, (_event, ...args) => listener(...args));
    }
  },
});
`,
  );
  return preloadPath;
};

/**
 * Get the target display for the widget.
 * Falls back to the primary display if the requested index is out of range.
 */
const getTargetDisplay = () => {
  const displays = screen.getAllDisplays();
  return displays[selectedMonitorIndex] ?? screen.getPrimaryDisplay();
};

/**
 * Detect the taskbar region by comparing display bounds with the work area.
 * Returns the position and dimensions of the taskbar on the target display.
 */
const getTaskbarGeometry = () => {
  const display = getTargetDisplay();
  const { bounds, workArea } = display;

  // The taskbar occupies the gap between the full screen bounds
  // and the usable work area (bottom taskbar is the Windows 11 default)
  const taskbarHeight =
    bounds.height - workArea.height - (workArea.y - bounds.y);
  const taskbarY = workArea.y + workArea.height;

  return {
    taskbarHeight: taskbarHeight > 0 ? taskbarHeight : DEFAULT_TASKBAR_HEIGHT,
    taskbarY:
      taskbarHeight > 0
        ? taskbarY
        : bounds.y + bounds.height - DEFAULT_TASKBAR_HEIGHT,
    screenWidth: bounds.width,
    screenX: bounds.x,
  };
};

/**
 * Calculate the widget window position so it sits on the taskbar surface,
 * to the left of the notification / system tray area.
 * User-configured offsets are applied on top of the computed position.
 */
const getWidgetBounds = () => {
  const { taskbarHeight, taskbarY, screenWidth, screenX } =
    getTaskbarGeometry();

  return {
    x:
      screenX +
      screenWidth -
      currentWidgetWidth -
      SYSTEM_TRAY_ESTIMATED_WIDTH +
      positionOffsetX,
    y: taskbarY + positionOffsetY,
    width: currentWidgetWidth,
    height: taskbarHeight,
  };
};

const getMiniPlayerHTML = (widgetHeight: number): string => {
  // Scale UI elements relative to taskbar height
  const albumSize = Math.max(widgetHeight - 12, 24);
  const titleFontSize = widgetHeight >= 48 ? 12 : 10;
  const artistFontSize = widgetHeight >= 48 ? 10 : 9;
  const btnSize = widgetHeight >= 48 ? 24 : 22;
  const iconSize = widgetHeight >= 48 ? 14 : 13;
  const playIconSize = widgetHeight >= 48 ? 18 : 15;
  const containerPadding = widgetHeight >= 48 ? '2px 4px' : '1px 3px';
  // Max width of the title/artist block before text is truncated with ellipsis
  const infoMaxWidth = 160;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
      user-select: none;
    }
    body {
      font-family: 'Segoe UI Variable', 'Segoe UI', sans-serif;
      background: transparent;
      color: #fff;
      overflow: hidden;
      height: 100vh;
    }
    .container {
      display: inline-flex;
      align-items: center;
      padding: ${containerPadding};
      gap: 3px;
      height: 100%;
    }
    .container.blur-bg {
      background: rgba(0, 0, 0, 0.3);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border-radius: 4px;
    }
    .album-art {
      width: ${albumSize}px;
      height: ${albumSize}px;
      border-radius: 4px;
      object-fit: cover;
      flex-shrink: 0;
      background: rgba(255, 255, 255, 0.1);
    }
    .info {
      max-width: ${infoMaxWidth}px;
      min-width: 0;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 1px;
    }
    .title {
      font-size: ${titleFontSize}px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1.2;
    }
    .artist {
      font-size: ${artistFontSize}px;
      color: rgba(255, 255, 255, 0.6);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1.2;
    }
    .controls {
      display: flex;
      align-items: center;
      gap: 0px;
      flex-shrink: 0;
    }
    .controls button {
      background: none;
      border: none;
      color: #fff;
      cursor: pointer;
      width: ${btnSize}px;
      height: ${btnSize}px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.1s;
      padding: 0;
    }
    .controls button:hover {
      background: rgba(255, 255, 255, 0.1);
    }
    .controls button:active {
      background: rgba(255, 255, 255, 0.2);
    }
    .controls button svg {
      width: ${iconSize}px;
      height: ${iconSize}px;
      fill: currentColor;
    }
    .play-pause svg {
      width: ${playIconSize}px;
      height: ${playIconSize}px;
    }
    .no-song {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: rgba(255, 255, 255, 0.4);
      font-size: ${artistFontSize}px;
      padding: 0 8px;
      white-space: nowrap;
    }
  </style>
</head>
<body>
  <div class="container" id="player" style="display: none;">
    <img class="album-art" id="albumArt" src="" alt="Album art">
    <div class="info">
      <div class="title" id="title"></div>
      <div class="artist" id="artist"></div>
    </div>
    <div class="controls">
      <button id="prevBtn" title="Previous">
        <svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
      </button>
      <button class="play-pause" id="playPauseBtn" title="Play/Pause">
        <svg id="playIcon" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        <svg id="pauseIcon" viewBox="0 0 24 24" style="display:none;"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
      </button>
      <button id="nextBtn" title="Next">
        <svg viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
      </button>
    </div>
  </div>
  <div class="no-song" id="noSong">No song playing</div>
  <script>
    const title = document.getElementById('title');
    const artist = document.getElementById('artist');
    const albumArt = document.getElementById('albumArt');
    const playIcon = document.getElementById('playIcon');
    const pauseIcon = document.getElementById('pauseIcon');
    const player = document.getElementById('player');
    const noSong = document.getElementById('noSong');

    // Report content width to main process so the BrowserWindow can resize
    let resizeTimer;
    const reportWidth = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const visible = player.style.display !== 'none' ? player : noSong;
        const width = Math.ceil(visible.getBoundingClientRect().width);
        if (width > 0) {
          window.widgetIpc.send('taskbar-widget:resize', width);
        }
      }, 50);
    };

    // Observe size changes on both elements
    const ro = new ResizeObserver(() => reportWidth());
    ro.observe(player);
    ro.observe(noSong);

    window.widgetIpc.on('taskbar-widget:song-info', (info) => {
      if (info && info.title) {
        player.style.display = 'inline-flex';
        noSong.style.display = 'none';
        title.textContent = info.title;
        artist.textContent = info.artist || '';
        if (info.imageSrc) {
          albumArt.src = info.imageSrc;
        }
        if (info.isPaused) {
          playIcon.style.display = 'block';
          pauseIcon.style.display = 'none';
        } else {
          playIcon.style.display = 'none';
          pauseIcon.style.display = 'block';
        }
        // Report after content update in case ResizeObserver misses it
        requestAnimationFrame(() => reportWidth());
      }
    });

    window.widgetIpc.on('taskbar-widget:set-blur', (enabled) => {
      if (enabled) {
        player.classList.add('blur-bg');
      } else {
        player.classList.remove('blur-bg');
      }
    });

    document.getElementById('prevBtn').addEventListener('click', () => {
      window.widgetIpc.send('taskbar-widget:control', 'previous');
    });
    document.getElementById('playPauseBtn').addEventListener('click', () => {
      window.widgetIpc.send('taskbar-widget:control', 'playPause');
    });
    document.getElementById('nextBtn').addEventListener('click', () => {
      window.widgetIpc.send('taskbar-widget:control', 'next');
    });
  </script>
</body>
</html>`;
};

const writeHtmlFile = (widgetHeight: number): string => {
  const htmlPath = path.join(getWidgetDir(), 'index.html');
  fs.writeFileSync(htmlPath, getMiniPlayerHTML(widgetHeight));
  return htmlPath;
};

/**
 * Recover visibility if the widget was hidden externally.
 */
const recoverVisibility = () => {
  if (
    isShowing &&
    !intentionalClose &&
    miniPlayerWin &&
    !miniPlayerWin.isDestroyed() &&
    !miniPlayerWin.isVisible()
  ) {
    miniPlayerWin.showInactive();
    miniPlayerWin.setAlwaysOnTop(true, 'screen-saver');
    miniPlayerWin.moveTop();
  }
};

/**
 * Reposition the widget and reassert z-order.
 * Called on display changes and periodically to handle auto-hide taskbar
 * and z-index loss from window focus changes.
 * Also recovers visibility if the widget was hidden externally.
 */
const repositionWidget = () => {
  if (!miniPlayerWin || miniPlayerWin.isDestroyed()) return;

  const bounds = getWidgetBounds();

  // Only call setBounds when the position/size actually changed to avoid
  // unnecessary window manipulation that can cause flickering or broken
  // rendering on some systems.
  if (
    !lastBounds ||
    lastBounds.x !== bounds.x ||
    lastBounds.y !== bounds.y ||
    lastBounds.width !== bounds.width ||
    lastBounds.height !== bounds.height
  ) {
    miniPlayerWin.setBounds(bounds);
    lastBounds = bounds;
  }

  // Reassert z-order so the widget stays above the taskbar even after
  // other windows are moved / focused.
  miniPlayerWin.setAlwaysOnTop(true, 'screen-saver');

  recoverVisibility();
};

export const createMiniPlayer = async (
  mainWindow: BrowserWindow,
  monitorIndex = 0,
  offsetX = 0,
  offsetY = 0,
  blurEnabled = false,
) => {
  const { playPause, next, previous } = getSongControls(mainWindow);

  // Reset state from any previous session
  intentionalClose = false;
  isShowing = false;
  currentWidgetWidth = MIN_WIDGET_WIDTH;
  lastBounds = null;

  selectedMonitorIndex = monitorIndex;
  positionOffsetX = offsetX;
  positionOffsetY = offsetY;
  backgroundBlurEnabled = blurEnabled;
  const preloadPath = writePreloadScript();
  const { x, y, width, height } = getWidgetBounds();
  const htmlPath = writeHtmlFile(height);

  miniPlayerWin = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    transparent: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: false,
    show: false,
    // 'toolbar' type prevents third-party window managers (e.g. DisplayFusion)
    // from attaching overlays such as "move to next monitor" buttons
    type: 'toolbar',
    webPreferences: {
      contextIsolation: true,
      preload: preloadPath,
    },
  });

  // Use 'screen-saver' z-level so the widget renders above the taskbar
  miniPlayerWin.setAlwaysOnTop(true, 'screen-saver');

  await miniPlayerWin.loadFile(htmlPath);

  // Apply initial blur setting
  if (backgroundBlurEnabled) {
    miniPlayerWin.webContents.send('taskbar-widget:set-blur', true);
  }

  // Make the window click-through until we have a song to display.
  // This prevents an invisible (transparent) window from blocking
  // taskbar clicks on the system tray arrow, pinned icons, etc.
  miniPlayerWin.setIgnoreMouseEvents(true, { forward: true });

  // Reposition when display configuration changes (resolution, DPI, etc.)
  displayChangeHandler = () => repositionWidget();
  screen.on('display-metrics-changed', displayChangeHandler);

  // Periodically reposition and reassert z-order so the widget adapts to
  // auto-hide taskbar state changes and recovers from z-index loss.
  repositionTimer = setInterval(
    () => repositionWidget(),
    REPOSITION_INTERVAL_MS,
  );

  // Handle control commands from the mini player
  controlHandler = (_, command: string) => {
    switch (command) {
      case 'previous': {
        previous();
        break;
      }

      case 'playPause': {
        playPause();
        break;
      }

      case 'next': {
        next();
        break;
      }
    }
  };

  ipcMain.on('taskbar-widget:control', controlHandler);

  // Handle dynamic resize requests from the renderer
  resizeHandler = (_, width: number) => {
    if (!miniPlayerWin || miniPlayerWin.isDestroyed()) return;
    // Add a small buffer for sub-pixel rounding
    const clamped = Math.max(
      MIN_WIDGET_WIDTH,
      Math.min(Math.ceil(width) + 2, MAX_WIDGET_WIDTH),
    );
    if (clamped !== currentWidgetWidth) {
      currentWidgetWidth = clamped;
      repositionWidget();
    }
  };

  ipcMain.on('taskbar-widget:resize', resizeHandler);

  // Send song info to the mini player
  const sendSongInfo = (songInfo: SongInfo) => {
    if (!miniPlayerWin || miniPlayerWin.isDestroyed()) return;

    miniPlayerWin.webContents.send('taskbar-widget:song-info', {
      title: songInfo.title,
      artist: songInfo.artist,
      imageSrc: songInfo.imageSrc,
      isPaused: songInfo.isPaused,
    });

    // Show the mini player once we have a song
    if (songInfo.title && !miniPlayerWin.isVisible()) {
      isShowing = true;
      miniPlayerWin.setIgnoreMouseEvents(false);
      miniPlayerWin.showInactive();
    }
  };

  registerCallback((songInfo, event) => {
    if (event !== SongInfoEvent.TimeChanged) {
      sendSongInfo(songInfo);
    }
  });

  // Clean up when main window is closed
  mainWindow.on('closed', () => {
    cleanup();
  });
};

/**
 * Live-update configuration without recreating the window.
 * Called from the plugin's onConfigChange handler.
 */
export const updateConfig = (
  offsetX: number,
  offsetY: number,
  blurEnabled: boolean,
) => {
  positionOffsetX = offsetX;
  positionOffsetY = offsetY;
  backgroundBlurEnabled = blurEnabled;
  lastBounds = null; // Force reposition on next tick

  if (miniPlayerWin && !miniPlayerWin.isDestroyed()) {
    repositionWidget();
    miniPlayerWin.webContents.send('taskbar-widget:set-blur', blurEnabled);
  }
};

export const cleanup = () => {
  intentionalClose = true;
  isShowing = false;

  if (controlHandler) {
    ipcMain.removeListener('taskbar-widget:control', controlHandler);
    controlHandler = null;
  }

  if (resizeHandler) {
    ipcMain.removeListener('taskbar-widget:resize', resizeHandler);
    resizeHandler = null;
  }

  if (displayChangeHandler) {
    screen.removeListener('display-metrics-changed', displayChangeHandler);
    displayChangeHandler = null;
  }

  if (repositionTimer) {
    clearInterval(repositionTimer);
    repositionTimer = null;
  }

  if (miniPlayerWin && !miniPlayerWin.isDestroyed()) {
    miniPlayerWin.close();
  }

  miniPlayerWin = null;
};
