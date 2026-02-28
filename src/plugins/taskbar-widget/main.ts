import path from 'node:path';
import fs from 'node:fs';

import { app, BrowserWindow, ipcMain, screen } from 'electron';

import { getSongControls } from '@/providers/song-controls';
import {
  registerCallback,
  type SongInfo,
  SongInfoEvent,
} from '@/providers/song-info';

const WIDGET_WIDTH = 300;
// Default taskbar height on Windows 11 (used as fallback)
const DEFAULT_TASKBAR_HEIGHT = 48;
// Estimated width of the system tray area (hidden icons arrow, pinned
// tray icons, clock, action center) so the widget sits to their left.
// Windows 11 only supports the bottom taskbar position.
const SYSTEM_TRAY_ESTIMATED_WIDTH = 300;

let miniPlayerWin: BrowserWindow | null = null;
let controlHandler:
  | ((_: Electron.IpcMainEvent, command: string) => void)
  | null = null;
let displayChangeHandler: (() => void) | null = null;

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
const ALLOWED_SEND = ['taskbar-widget:control'];
const ALLOWED_RECEIVE = ['taskbar-widget:song-info'];
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
 * Detect the taskbar region by comparing display bounds with the work area.
 * Returns the position and dimensions of the taskbar on the primary display.
 */
const getTaskbarGeometry = () => {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { bounds, workArea } = primaryDisplay;

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
 */
const getWidgetBounds = () => {
  const { taskbarHeight, taskbarY, screenWidth, screenX } =
    getTaskbarGeometry();

  return {
    x: screenX + screenWidth - WIDGET_WIDTH - SYSTEM_TRAY_ESTIMATED_WIDTH,
    y: taskbarY,
    width: WIDGET_WIDTH,
    height: taskbarHeight,
  };
};

const getMiniPlayerHTML = (widgetHeight: number): string => {
  // Scale UI elements relative to taskbar height
  const albumSize = Math.max(widgetHeight - 12, 24);
  const titleFontSize = widgetHeight >= 48 ? 12 : 10;
  const artistFontSize = widgetHeight >= 48 ? 10 : 9;
  const btnSize = widgetHeight >= 48 ? 28 : 24;
  const iconSize = widgetHeight >= 48 ? 16 : 14;
  const playIconSize = widgetHeight >= 48 ? 20 : 16;
  const containerPadding = widgetHeight >= 48 ? '4px 8px' : '2px 6px';

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
      display: flex;
      align-items: center;
      padding: ${containerPadding};
      gap: 8px;
      height: 100%;
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
      flex: 1;
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
      gap: 2px;
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
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: rgba(255, 255, 255, 0.4);
      font-size: ${artistFontSize}px;
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

    window.widgetIpc.on('taskbar-widget:song-info', (info) => {
      if (info && info.title) {
        player.style.display = 'flex';
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

/** Reposition the widget when the display layout changes. */
const repositionWidget = () => {
  if (!miniPlayerWin || miniPlayerWin.isDestroyed()) return;

  const { x, y, width, height } = getWidgetBounds();
  miniPlayerWin.setBounds({ x, y, width, height });
};

export const createMiniPlayer = async (mainWindow: BrowserWindow) => {
  const { playPause, next, previous } = getSongControls(mainWindow);

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
    alwaysOnTop: true,
    resizable: false,
    movable: false,
    focusable: false,
    show: false,
    webPreferences: {
      contextIsolation: true,
      preload: preloadPath,
    },
  });

  await miniPlayerWin.loadFile(htmlPath);

  // Reposition when display configuration changes (resolution, DPI, etc.)
  displayChangeHandler = () => repositionWidget();
  screen.on('display-metrics-changed', displayChangeHandler);

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

export const cleanup = () => {
  if (controlHandler) {
    ipcMain.removeListener('taskbar-widget:control', controlHandler);
    controlHandler = null;
  }

  if (displayChangeHandler) {
    screen.removeListener('display-metrics-changed', displayChangeHandler);
    displayChangeHandler = null;
  }

  if (miniPlayerWin && !miniPlayerWin.isDestroyed()) {
    miniPlayerWin.close();
  }

  miniPlayerWin = null;
};
