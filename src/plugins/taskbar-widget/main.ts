import path from 'node:path';
import fs from 'node:fs';

import { app, BrowserWindow, ipcMain, screen } from 'electron';

import { getSongControls } from '@/providers/song-controls';
import {
  registerCallback,
  type SongInfo,
  SongInfoEvent,
} from '@/providers/song-info';

const WIDGET_WIDTH = 320;
const WIDGET_HEIGHT = 80;

let miniPlayerWin: BrowserWindow | null = null;
let controlHandler:
  | ((_: Electron.IpcMainEvent, command: string) => void)
  | null = null;

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

const getMiniPlayerHTML = (): string => `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
      user-select: none;
      -webkit-app-region: drag;
    }
    body {
      font-family: 'Segoe UI', sans-serif;
      background: rgba(30, 30, 30, 0.95);
      color: #fff;
      overflow: hidden;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      height: 100vh;
    }
    .container {
      display: flex;
      align-items: center;
      padding: 8px;
      gap: 10px;
      height: 100%;
    }
    .album-art {
      width: 56px;
      height: 56px;
      border-radius: 6px;
      object-fit: cover;
      flex-shrink: 0;
      background: #333;
    }
    .info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 2px;
    }
    .title {
      font-size: 13px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .artist {
      font-size: 11px;
      color: rgba(255, 255, 255, 0.65);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .controls {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
      -webkit-app-region: no-drag;
    }
    .controls button {
      background: none;
      border: none;
      color: #fff;
      cursor: pointer;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s;
      padding: 0;
    }
    .controls button:hover {
      background: rgba(255, 255, 255, 0.15);
    }
    .controls button:active {
      background: rgba(255, 255, 255, 0.25);
    }
    .controls button svg {
      width: 18px;
      height: 18px;
      fill: currentColor;
    }
    .play-pause svg {
      width: 22px;
      height: 22px;
    }
    .no-song {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: rgba(255, 255, 255, 0.5);
      font-size: 12px;
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

const writeHtmlFile = (): string => {
  const htmlPath = path.join(getWidgetDir(), 'index.html');
  fs.writeFileSync(htmlPath, getMiniPlayerHTML());
  return htmlPath;
};

export const createMiniPlayer = async (mainWindow: BrowserWindow) => {
  const { playPause, next, previous } = getSongControls(mainWindow);

  const preloadPath = writePreloadScript();
  const htmlPath = writeHtmlFile();

  // Position at bottom-right, above the taskbar
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } =
    primaryDisplay.workAreaSize;

  miniPlayerWin = new BrowserWindow({
    width: WIDGET_WIDTH,
    height: WIDGET_HEIGHT,
    x: screenWidth - WIDGET_WIDTH - 10,
    y: screenHeight - WIDGET_HEIGHT - 10,
    frame: false,
    transparent: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    resizable: false,
    show: false,
    webPreferences: {
      contextIsolation: true,
      preload: preloadPath,
    },
  });

  await miniPlayerWin.loadFile(htmlPath);

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

  if (miniPlayerWin && !miniPlayerWin.isDestroyed()) {
    miniPlayerWin.close();
  }

  miniPlayerWin = null;
};
