import { net, BrowserWindow, ipcMain, screen } from 'electron';

import { createBackend } from '@/utils';

let floatingWin: BrowserWindow | null = null;

const FLOATING_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }

html, body {
  width: 100%; height: 100%;
  overflow: hidden;
  background: transparent;
  font-family: 'Google Sans', 'Segoe UI', Roboto, sans-serif;
  user-select: none;
  color: #fff;
}

#window-root {
  width: 100%; height: 100%;
  display: flex;
  flex-direction: column;
  border-radius: 16px;
  overflow: hidden;
  background: rgba(12, 12, 18, var(--bg-opacity, 0.85));
  backdrop-filter: blur(24px) saturate(1.4);
  -webkit-backdrop-filter: blur(24px) saturate(1.4);
  border: 1px solid rgba(255,255,255,0.08);
}

/* ─── Titlebar ──────────────────────────────────── */
#titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  -webkit-app-region: drag;
  flex-shrink: 0;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}

#titlebar-title {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255,255,255,0.7);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  margin-right: 8px;
}

.tb-btn {
  -webkit-app-region: no-drag;
  width: 28px; height: 28px;
  border-radius: 50%;
  border: none;
  background: rgba(255,255,255,0.06);
  color: rgba(255,255,255,0.6);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  margin-left: 4px;
  transition: all 0.2s;
}

.tb-btn:hover { background: rgba(255,255,255,0.14); color: #fff; }
.tb-btn.pinned { background: rgba(120,86,255,0.3); color: #a78bfa; }

/* ─── Song Info ─────────────────────────────────── */
#song-info {
  padding: 10px 16px;
  flex-shrink: 0;
  border-bottom: 1px solid rgba(255,255,255,0.04);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

#song-info-text {
  flex: 1;
  min-width: 0;
  margin-right: 12px;
}

#song-title {
  font-size: 13px;
  font-weight: 600;
  color: #e0e0e0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

#song-artist {
  font-size: 11px;
  color: rgba(255,255,255,0.45);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ─── Playback Controls ─────────────────────────── */
#playback-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pb-btn {
  -webkit-app-region: no-drag;
  width: 32px; height: 32px;
  border-radius: 50%;
  border: none;
  background: rgba(255,255,255,0.08);
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  transition: all 0.2s;
}

.pb-btn:hover {
  background: rgba(255,255,255,0.2);
  transform: scale(1.05);
}

/* ─── Lyrics Area ───────────────────────────────── */
#lyrics-area {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 16px 20px;
  scroll-behavior: smooth;
  scrollbar-width: thin;
  scrollbar-color: rgba(255,255,255,0.1) transparent;
}

.lyric-line {
  padding: 6px 0;
  font-size: 18px;
  font-weight: 500;
  line-height: 1.5;
  color: rgba(255,255,255, var(--text-opacity, 1));
  opacity: 0.3;
  transition: opacity 0.3s, transform 0.3s, font-weight 0.2s;
  cursor: default;
  transform: scale(0.97);
  transform-origin: left center;
}

.lyric-line.current {
  opacity: 1;
  font-weight: 700;
  transform: scale(1);
}

.lyric-line.previous {
  opacity: 0.25;
}

.lyric-line.plain {
  opacity: calc(0.7 * var(--text-opacity, 1));
  font-size: 16px;
  font-weight: 400;
  transform: none;
}

#lyrics-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: rgba(255,255,255,0.25);
  font-size: 32px;
}

/* ─── Controls ──────────────────────────────────── */
#controls {
  padding: 10px 16px;
  border-top: 1px solid rgba(255,255,255,0.06);
  flex-shrink: 0;
  display: none; /* hidden by default */
  flex-direction: column;
  gap: 6px;
}

.ctrl-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: rgba(255,255,255,0.5);
}

.ctrl-row label {
  width: 55px;
  flex-shrink: 0;
}

.ctrl-row input[type="range"] {
  flex: 1;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: rgba(255,255,255,0.1);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}

.ctrl-row input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px; height: 14px;
  border-radius: 50%;
  background: #a78bfa;
  border: none;
  cursor: pointer;
}

.ctrl-row .value {
  width: 30px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
</style>
</head>
<body>
<div id="window-root">
  <div id="titlebar">
    <div id="titlebar-title">♪ Letras</div>
    <button class="tb-btn" id="btn-toggle-controls" title="Mostrar/Ocultar opacidad">⚙</button>
    <button class="tb-btn pinned" id="btn-pin" title="Fijar encima">📌</button>
    <button class="tb-btn" id="btn-close" title="Cerrar">✕</button>
  </div>

  <div id="song-info">
    <div id="song-info-text">
      <div id="song-title">—</div>
      <div id="song-artist">—</div>
    </div>
    <div id="playback-controls">
      <button class="pb-btn" id="btn-prev" title="Anterior">⏮</button>
      <button class="pb-btn" id="btn-playpause" title="Reproducir/Pausar">⏸</button>
      <button class="pb-btn" id="btn-next" title="Siguiente">⏭</button>
    </div>
  </div>

  <div id="lyrics-area">
    <div id="lyrics-empty">♪</div>
  </div>

  <div id="controls">
    <div class="ctrl-row">
      <label>Fondo</label>
      <input type="range" id="bg-opacity" min="0" max="100" value="85">
      <span class="value" id="bg-val">85%</span>
    </div>
    <div class="ctrl-row">
      <label>Texto</label>
      <input type="range" id="text-opacity" min="10" max="100" value="100">
      <span class="value" id="text-val">100%</span>
    </div>
  </div>
</div>

<script>
const { ipcRenderer } = require('electron');

const root = document.getElementById('window-root');
const lyricsArea = document.getElementById('lyrics-area');
const songTitle = document.getElementById('song-title');
const songArtist = document.getElementById('song-artist');
const bgSlider = document.getElementById('bg-opacity');
const textSlider = document.getElementById('text-opacity');
const bgVal = document.getElementById('bg-val');
const textVal = document.getElementById('text-val');
const btnPin = document.getElementById('btn-pin');
const btnClose = document.getElementById('btn-close');
const btnToggleControls = document.getElementById('btn-toggle-controls');
const controls = document.getElementById('controls');
const btnPrev = document.getElementById('btn-prev');
const btnPlayPause = document.getElementById('btn-playpause');
const btnNext = document.getElementById('btn-next');

let lines = [];
let isPlain = false;
let lastActiveIdx = -1;
let controlsVisible = false;

// ─── Controls ───────────────────────────────────
bgSlider.addEventListener('input', () => {
  const v = bgSlider.value / 100;
  root.style.setProperty('--bg-opacity', v);
  bgVal.textContent = bgSlider.value + '%';
});

textSlider.addEventListener('input', () => {
  const v = textSlider.value / 100;
  root.style.setProperty('--text-opacity', v);
  textVal.textContent = textSlider.value + '%';
});

btnToggleControls.addEventListener('click', () => {
  controlsVisible = !controlsVisible;
  controls.style.display = controlsVisible ? 'flex' : 'none';
});

btnPin.addEventListener('click', () => {
  ipcRenderer.invoke('floating-lyrics:toggle-pin').then(pinned => {
    btnPin.classList.toggle('pinned', pinned);
  });
});

btnClose.addEventListener('click', () => {
  ipcRenderer.invoke('floating-lyrics:close');
});

// Playback actions
btnPrev.addEventListener('click', () => ipcRenderer.invoke('floating-lyrics:action', 'prev'));
btnPlayPause.addEventListener('click', () => ipcRenderer.invoke('floating-lyrics:action', 'playpause'));
btnNext.addEventListener('click', () => ipcRenderer.invoke('floating-lyrics:action', 'next'));

// ─── IPC Listeners ──────────────────────────────
ipcRenderer.on('floating-lyrics-song', (_, song) => {
  songTitle.textContent = song.title || '—';
  songArtist.textContent = song.artist || '—';
});

ipcRenderer.on('floating-lyrics-data', (_, data) => {
  lyricsArea.innerHTML = '';
  lastActiveIdx = -1;

  if (!data) {
    lyricsArea.innerHTML = '<div id="lyrics-empty">♪</div>';
    lines = [];
    isPlain = false;
    return;
  }

  if (data.lines && data.lines.length > 0) {
    isPlain = false;
    lines = data.lines;
    lines.forEach((line, i) => {
      const el = document.createElement('div');
      el.className = 'lyric-line upcoming';
      el.textContent = line.text || '♪';
      el.dataset.idx = i;
      lyricsArea.appendChild(el);
    });
  } else if (data.lyrics) {
    isPlain = true;
    lines = [];
    const plainLines = data.lyrics.split('\\n').filter(l => l.trim());
    plainLines.forEach(text => {
      const el = document.createElement('div');
      el.className = 'lyric-line plain';
      el.textContent = text;
      lyricsArea.appendChild(el);
    });
  } else {
    lyricsArea.innerHTML = '<div id="lyrics-empty">♪</div>';
    lines = [];
    isPlain = false;
  }
});

ipcRenderer.on('floating-lyrics-time', (_, timeMs) => {
  if (isPlain || lines.length === 0) return;

  const els = lyricsArea.querySelectorAll('.lyric-line');
  let activeIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (timeMs >= line.timeInMs && timeMs < line.timeInMs + line.duration) {
      activeIdx = i;
    }
    
    const el = els[i];
    if (!el) continue;

    if (timeMs >= line.timeInMs && timeMs < line.timeInMs + line.duration) {
      el.className = 'lyric-line current';
    } else if (timeMs >= line.timeInMs + line.duration) {
      el.className = 'lyric-line previous';
    } else {
      el.className = 'lyric-line upcoming';
    }
  }

  // Auto-scroll to current line
  if (activeIdx !== -1 && activeIdx !== lastActiveIdx) {
    lastActiveIdx = activeIdx;
    const activeEl = els[activeIdx];
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
});

ipcRenderer.on('floating-lyrics-state', (_, isPaused) => {
  btnPlayPause.textContent = isPaused ? '▶' : '⏸';
});

// Tell the main process we are ready to receive data
ipcRenderer.send('synced-lyrics:floating-ready');
</script>
</body>
</html>`;

// ─── Backend ─────────────────────────────────────────────────────────────────

const handlers = {
  async fetch(
    url: string,
    init: RequestInit,
  ): Promise<[number, string, Record<string, string>]> {
    const res = await net.fetch(url, init);
    return [
      res.status,
      await res.text(),
      Object.fromEntries(res.headers.entries()),
    ];
  },
};

export const backend = createBackend({
  start(ctx) {
    ctx.ipc.handle('synced-lyrics:fetch', (url: string, init: RequestInit) =>
      handlers.fetch(url, init),
    );

    // ─── Floating window management ──────────────────────────────
    ctx.ipc.handle('synced-lyrics:open-floating', () => {
      if (floatingWin && !floatingWin.isDestroyed()) {
        floatingWin.focus();
        return;
      }

      const { width } = screen.getPrimaryDisplay().workAreaSize;

      floatingWin = new BrowserWindow({
        width: 380,
        height: 520,
        x: width - 400,
        y: 40,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: true,
        minimizable: false,
        hasShadow: true,
        focusable: true,
        parent: ctx.window,
        type: 'panel',
        show: false,
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false,
          sandbox: false,
        },
      });

      floatingWin.once('ready-to-show', () => {
        floatingWin?.show();
        floatingWin?.setAlwaysOnTop(true, 'status', 1);
        floatingWin?.setVisibleOnAllWorkspaces(true, {
          visibleOnFullScreen: true,
        });
      });

      floatingWin.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(FLOATING_HTML)}`,
      );

      floatingWin.on('closed', () => {
        floatingWin = null;
        ctx.ipc.send('synced-lyrics:floating-closed');
      });

      floatingWin.on('blur', () => {
        if (floatingWin && !floatingWin.isDestroyed() && floatingWin.isAlwaysOnTop()) {
          // Aggressively enforce always-on-top on focus loss (for strict Linux WMs)
          floatingWin.setAlwaysOnTop(true, 'screen-saver', 1);
        }
      });
    });

    ctx.ipc.handle('synced-lyrics:close-floating', () => {
      if (floatingWin && !floatingWin.isDestroyed()) {
        floatingWin.close();
      }
    });

    ctx.ipc.on(
      'synced-lyrics:floating-lyrics',
      (data: { lines?: unknown[]; lyrics?: string } | null) => {
        if (floatingWin && !floatingWin.isDestroyed()) {
          floatingWin.webContents.send('floating-lyrics-data', data);
        }
      },
    );

    ctx.ipc.on('synced-lyrics:floating-time', (time: number) => {
      if (floatingWin && !floatingWin.isDestroyed()) {
        floatingWin.webContents.send('floating-lyrics-time', time);
      }
    });

    ctx.ipc.on('synced-lyrics:floating-state', (isPaused: boolean) => {
      if (floatingWin && !floatingWin.isDestroyed()) {
        floatingWin.webContents.send('floating-lyrics-state', isPaused);
      }
    });

    ctx.ipc.on(
      'synced-lyrics:floating-song',
      (song: { title: string; artist: string }) => {
        if (floatingWin && !floatingWin.isDestroyed()) {
          floatingWin.webContents.send('floating-lyrics-song', song);
        }
      },
    );

    ipcMain.on('synced-lyrics:floating-ready', () => {
      ctx.ipc.send('synced-lyrics:floating-request-data');
    });

    // Controls from floating window
    ipcMain.handle('floating-lyrics:toggle-pin', () => {
      if (floatingWin && !floatingWin.isDestroyed()) {
        const isOnTop = floatingWin.isAlwaysOnTop();
        if (isOnTop) {
          floatingWin.setAlwaysOnTop(false);
          floatingWin.setVisibleOnAllWorkspaces(false);
        } else {
          floatingWin.setAlwaysOnTop(true, 'status', 1);
          floatingWin.setVisibleOnAllWorkspaces(true, {
            visibleOnFullScreen: true,
          });
        }
        return !isOnTop;
      }
      return false;
    });

    ipcMain.handle('floating-lyrics:close', () => {
      if (floatingWin && !floatingWin.isDestroyed()) {
        floatingWin.close();
      }
    });

    ipcMain.handle('floating-lyrics:action', (_, action) => {
      ctx.ipc.send('synced-lyrics:floating-action', action);
    });
  },

  stop(ctx) {
    ctx.ipc.removeHandler('synced-lyrics:fetch');
    ctx.ipc.removeHandler('synced-lyrics:open-floating');
    ctx.ipc.removeHandler('synced-lyrics:close-floating');

    ipcMain.removeHandler('floating-lyrics:toggle-pin');
    ipcMain.removeHandler('floating-lyrics:close');

    if (floatingWin && !floatingWin.isDestroyed()) {
      floatingWin.close();
      floatingWin = null;
    }
  },
});
