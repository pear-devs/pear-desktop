import path from 'node:path';
import fs from 'node:fs';

import {
  app,
  BrowserWindow,
  ipcMain,
  nativeImage,
  net,
  screen,
} from 'electron';

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
// How often (ms) to re-check and reposition the widget (bounds only).
// Handles auto-hide taskbar changes.  Z-order is maintained event-driven.
const REPOSITION_INTERVAL_MS = 200;
// When the widget is hidden externally (e.g. Start menu opens), an aggressive
// recovery interval fires every HIDE_RECOVERY_INTERVAL_MS for up to
// HIDE_RECOVERY_DURATION_MS.  This covers both fast transitions (clicking a
// pinned taskbar icon) and slower system overlay animations (Start menu).
const HIDE_RECOVERY_INTERVAL_MS = 100;
const HIDE_RECOVERY_DURATION_MS = 3000;

let miniPlayerWin: BrowserWindow | null = null;
// Keep a reference to the main window so cleanup can remove event listeners.
let mainWindowRef: BrowserWindow | null = null;
let controlHandler:
  | ((_: Electron.IpcMainEvent, command: string) => void)
  | null = null;
let showWindowHandler: ((_: Electron.IpcMainEvent) => void) | null = null;
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
// Persistent interval used to recover from external hides (Start menu, etc.).
let hideRecoveryInterval: ReturnType<typeof setInterval> | null = null;
// Delayed recovery timers scheduled after main window blur events.
// The widget may be pushed behind the taskbar when shell overlays (Start menu,
// notification center) open.  These timers fire recovery attempts at staggered
// intervals so the widget reappears after the overlay closes.
let blurRecoveryTimers: ReturnType<typeof setTimeout>[] = [];
// Cached imageSrc URL for dominant-color extraction to avoid re-fetching.
let lastColorUrl: string | null = null;
// Handler references for main window blur/focus listeners so they can be
// cleaned up when the widget is destroyed.
let mainWindowBlurHandler: (() => void) | null = null;
let mainWindowFocusHandler: (() => void) | null = null;

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
const ALLOWED_SEND = ['taskbar-widget:control', 'taskbar-widget:resize', 'taskbar-widget:show-window'];
const ALLOWED_RECEIVE = ['taskbar-widget:song-info', 'taskbar-widget:set-blur', 'taskbar-widget:set-background-color'];
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
  const titleFontSize = widgetHeight >= 48 ? 13 : 11;
  const artistFontSize = widgetHeight >= 48 ? 11 : 10;
  const btnSize = widgetHeight >= 48 ? 24 : 22;
  const iconSize = widgetHeight >= 48 ? 14 : 13;
  const playIconSize = widgetHeight >= 48 ? 18 : 15;
  const containerPadding = widgetHeight >= 48 ? '4px 6px' : '2px 4px';
  const blurPadding = widgetHeight >= 48 ? '4px 8px' : '3px 6px';
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
      gap: 8px;
      height: 100%;
      cursor: pointer;
    }
    .container.blur-bg {
      background: var(--dynamic-bg, rgba(0, 0, 0, 0.3));
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border-radius: 8px;
      padding: ${blurPadding};
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

    window.widgetIpc.on('taskbar-widget:set-background-color', (color) => {
      if (color && color.r !== undefined) {
        var dr = Math.max(0, color.r - 40);
        var dg = Math.max(0, color.g - 40);
        var db = Math.max(0, color.b - 40);
        var gradient = 'linear-gradient(135deg, rgba(' + color.r + ',' + color.g + ',' + color.b + ',0.45), rgba(' + dr + ',' + dg + ',' + db + ',0.55))';
        player.style.setProperty('--dynamic-bg', gradient);
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

    // Clicking anywhere on the widget (outside of control buttons) opens
    // the main YouTube Music window.
    player.addEventListener('click', (e) => {
      if (!e.target.closest('.controls')) {
        window.widgetIpc.send('taskbar-widget:show-window');
      }
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
 * Extract the dominant colour from an album art URL using Electron's
 * nativeImage API.  Runs entirely in the main process so there are no
 * CORS issues.  Returns `null` when extraction fails for any reason.
 */
const extractDominantColor = async (
  imageUrl: string,
): Promise<{ r: number; g: number; b: number } | null> => {
  try {
    const response = await net.fetch(imageUrl);
    const buffer = Buffer.from(await response.arrayBuffer());
    const image = nativeImage.createFromBuffer(buffer);
    if (image.isEmpty()) return null;

    // Scale down for fast sampling
    const small = image.resize({ width: 16, height: 16 });
    const bitmap = small.toBitmap(); // BGRA on Windows

    let r = 0;
    let g = 0;
    let b = 0;
    let count = 0;
    for (let i = 0; i < bitmap.length; i += 4) {
      const blue = bitmap[i];
      const green = bitmap[i + 1];
      const red = bitmap[i + 2];
      const brightness = (red + green + blue) / 3;
      // Skip very dark / very bright pixels for a more representative colour
      if (brightness > 30 && brightness < 220) {
        r += red;
        g += green;
        b += blue;
        count++;
      }
    }

    if (count === 0) return null;

    let avgR = Math.round(r / count);
    let avgG = Math.round(g / count);
    let avgB = Math.round(b / count);

    // Cap brightness so white text stays readable on the semi-transparent bg
    const avgBrightness = (avgR + avgG + avgB) / 3;
    if (avgBrightness > 150) {
      const factor = 150 / avgBrightness;
      avgR = Math.round(avgR * factor);
      avgG = Math.round(avgG * factor);
      avgB = Math.round(avgB * factor);
    }

    return { r: avgR, g: avgG, b: avgB };
  } catch {
    return null;
  }
};

/** Cancel any pending blur-recovery timeouts. */
const clearBlurRecoveryTimers = () => {
  for (const timer of blurRecoveryTimers) clearTimeout(timer);
  blurRecoveryTimers = [];
};

/**
 * Schedule staggered recovery attempts after a main-window blur event.
 * The widget may be pushed behind the taskbar when shell overlays open
 * (Start menu, notification centre, etc.).  These delayed attempts ensure
 * recovery even when the overlay is slow to close and no further Electron
 * events fire.
 */
const scheduleBlurRecovery = () => {
  clearBlurRecoveryTimers();
  const delays = [300, 800, 1500, 3000];
  for (const delay of delays) {
    blurRecoveryTimers.push(
      setTimeout(() => {
        if (isShowing && !intentionalClose) recoverVisibility();
      }, delay),
    );
  }
};

/**
 * Recover visibility if the widget was hidden, minimized, or pushed behind
 * the taskbar by a system overlay (Start menu, shell flyouts, etc.).
 *
 * The z-order toggle (off → on) forces Windows to re-evaluate the TOPMOST
 * z-band.  To prevent a visible flash the window opacity is set to 0 before
 * the toggle and restored to 1 immediately after.  Because the Electron
 * calls are synchronous the compositor sees only the final state.
 */
const recoverVisibility = () => {
  if (
    !isShowing ||
    intentionalClose ||
    !miniPlayerWin ||
    miniPlayerWin.isDestroyed()
  ) {
    return;
  }

  if (miniPlayerWin.isMinimized()) {
    miniPlayerWin.restore();
  }

  if (!miniPlayerWin.isVisible()) {
    miniPlayerWin.showInactive();
    miniPlayerWin.setAlwaysOnTop(true, 'screen-saver');
    miniPlayerWin.moveTop();
    return;
  }

  // Hide briefly during z-order toggle to prevent visible flash.
  try {
    miniPlayerWin.setOpacity(0);
    miniPlayerWin.setAlwaysOnTop(false);
    miniPlayerWin.setAlwaysOnTop(true, 'screen-saver');
    miniPlayerWin.moveTop();
  } finally {
    if (miniPlayerWin && !miniPlayerWin.isDestroyed()) {
      miniPlayerWin.setOpacity(1);
    }
  }
};

/**
 * Reposition the widget if the display geometry changed.
 * Called periodically to handle auto-hide taskbar state transitions.
 *
 * Z-order is maintained entirely via event-driven handlers (blur, focus,
 * hide, minimize, always-on-top-changed) and the staggered recovery
 * timeouts in {@link scheduleBlurRecovery}.  No z-order manipulation
 * happens here to avoid the periodic stutter that plagued earlier
 * implementations.
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
};

export const createMiniPlayer = async (
  mainWindow: BrowserWindow,
  monitorIndex = 0,
  offsetX = 0,
  offsetY = 0,
  blurEnabled = false,
) => {
  const { playPause, next, previous } = getSongControls(mainWindow);
  mainWindowRef = mainWindow;

  // Reset state from any previous session
  intentionalClose = false;
  isShowing = false;
  currentWidgetWidth = MIN_WIDGET_WIDTH;
  lastBounds = null;
  lastColorUrl = null;
  clearBlurRecoveryTimers();

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

  // Immediately recover if the widget is hidden externally (e.g. by
  // taskbar interactions, Start menu opening, or window management tools).
  // A persistent interval keeps retrying for HIDE_RECOVERY_DURATION_MS so
  // recovery succeeds even after slower system overlay animations finish.
  miniPlayerWin.on('hide', () => {
    if (!isShowing || intentionalClose) return;
    if (hideRecoveryInterval) clearInterval(hideRecoveryInterval);
    recoverVisibility();
    let elapsed = 0;
    hideRecoveryInterval = setInterval(() => {
      elapsed += HIDE_RECOVERY_INTERVAL_MS;
      if (
        elapsed >= HIDE_RECOVERY_DURATION_MS ||
        !isShowing ||
        intentionalClose
      ) {
        if (hideRecoveryInterval) {
          clearInterval(hideRecoveryInterval);
          hideRecoveryInterval = null;
        }
        return;
      }
      recoverVisibility();
    }, HIDE_RECOVERY_INTERVAL_MS);
  });

  // Also recover immediately from any minimize event (the Start menu
  // may minimize overlay windows on some configurations).
  miniPlayerWin.on('minimize', () => {
    if (!isShowing || intentionalClose) return;
    recoverVisibility();
  });

  // Re-assert always-on-top if something steals z-order.
  miniPlayerWin.on('always-on-top-changed', (_event, isAlwaysOnTop) => {
    if (
      !isAlwaysOnTop &&
      isShowing &&
      !intentionalClose &&
      miniPlayerWin &&
      !miniPlayerWin.isDestroyed()
    ) {
      miniPlayerWin.setAlwaysOnTop(true, 'screen-saver');
      miniPlayerWin.moveTop();
    }
  });

  // Reposition when display configuration changes (resolution, DPI, etc.)
  displayChangeHandler = () => repositionWidget();
  screen.on('display-metrics-changed', displayChangeHandler);

  // When the main window loses focus the user may have clicked the taskbar,
  // the Start menu, or another shell overlay.  Schedule staggered recovery
  // attempts so the widget reappears after the overlay closes – even if no
  // further Electron events fire (e.g. focus stays on the taskbar).
  mainWindowBlurHandler = () => {
    if (isShowing && !intentionalClose) scheduleBlurRecovery();
  };
  mainWindow.on('blur', mainWindowBlurHandler);

  // When the main window regains focus, immediately ensure the widget is
  // on top (handles the case where the user switches back from another app).
  mainWindowFocusHandler = () => {
    if (isShowing && !intentionalClose) recoverVisibility();
  };
  mainWindow.on('focus', mainWindowFocusHandler);

  // Periodically reposition so the widget adapts to auto-hide taskbar
  // state changes.  Z-order is maintained event-driven (not here).
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

  // Clicking on the widget (outside buttons) brings the main window to front
  showWindowHandler = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  };

  ipcMain.on('taskbar-widget:show-window', showWindowHandler);

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

    // Extract dominant colour from album art for the dynamic blur background.
    // Only re-extract when the image URL changes.
    if (songInfo.imageSrc && songInfo.imageSrc !== lastColorUrl) {
      lastColorUrl = songInfo.imageSrc;
      extractDominantColor(songInfo.imageSrc).then((color) => {
        if (color && miniPlayerWin && !miniPlayerWin.isDestroyed()) {
          miniPlayerWin.webContents.send(
            'taskbar-widget:set-background-color',
            color,
          );
        }
      });
    }

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

  clearBlurRecoveryTimers();

  if (hideRecoveryInterval) {
    clearInterval(hideRecoveryInterval);
    hideRecoveryInterval = null;
  }

  if (controlHandler) {
    ipcMain.removeListener('taskbar-widget:control', controlHandler);
    controlHandler = null;
  }

  if (showWindowHandler) {
    ipcMain.removeListener('taskbar-widget:show-window', showWindowHandler);
    showWindowHandler = null;
  }

  if (resizeHandler) {
    ipcMain.removeListener('taskbar-widget:resize', resizeHandler);
    resizeHandler = null;
  }

  if (displayChangeHandler) {
    screen.removeListener('display-metrics-changed', displayChangeHandler);
    displayChangeHandler = null;
  }

  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    if (mainWindowBlurHandler) {
      mainWindowRef.removeListener('blur', mainWindowBlurHandler);
    }
    if (mainWindowFocusHandler) {
      mainWindowRef.removeListener('focus', mainWindowFocusHandler);
    }
  }
  mainWindowBlurHandler = null;
  mainWindowFocusHandler = null;
  mainWindowRef = null;

  if (repositionTimer) {
    clearInterval(repositionTimer);
    repositionTimer = null;
  }

  if (miniPlayerWin && !miniPlayerWin.isDestroyed()) {
    miniPlayerWin.close();
  }

  miniPlayerWin = null;
};
