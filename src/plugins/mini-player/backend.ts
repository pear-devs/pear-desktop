import { BrowserWindow } from 'electron';

import { getSongControls } from '@/providers/song-controls';
import {
  registerCallback,
  SongInfoEvent,
  type SongInfo,
} from '@/providers/song-info';
import { createBackend } from '@/utils';

import type { MiniPlayerPluginConfig } from './index';
import type { BackendContext } from '@/types/contexts';

const MINI_WIDTH = 340;
const MINI_HEIGHT = 150;
const MINI_HEIGHT_LYRICS = 216;

const pageHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; user-select: none; }
  html, body { margin: 0; height: 100%; color: #fff;
    font-family: 'Segoe UI', Roboto, sans-serif; overflow: hidden; }
  html { background: transparent; }
  body { background: #0d0d0d; }
  /* 1% alpha: a fully transparent body loses hit-testing on
     Windows and clicks would fall through to the desktop */
  body.transparent { background: rgba(13, 13, 13, 0.01); }
  body.transparent :is(.art, .title, .artist, .controls, .progress-wrap,
    .toolbar, .drag-handle) { opacity: 0; transition: opacity 0.2s ease; }
  body.transparent:hover :is(.art, .title, .artist, .controls, .progress-wrap,
    .toolbar, .drag-handle) { opacity: 1; }
  body { display: flex; flex-direction: column; padding: 10px;
    -webkit-app-region: drag; position: relative; }
  .toolbar { position: absolute; top: 4px; right: 6px; display: flex; gap: 2px;
    -webkit-app-region: no-drag; opacity: 0.55; z-index: 10;
    pointer-events: auto; }
  .toolbar:hover { opacity: 1; }
  .drag-handle { position: absolute; top: 4px; left: 6px; display: flex;
    align-items: center; justify-content: center; width: 26px; height: 22px;
    color: #ccc; font-size: 14px; cursor: move; opacity: 0.55; z-index: 10;
    -webkit-app-region: drag; }
  .drag-handle:hover { opacity: 1; }
  .toolbar a { display: flex; align-items: center; justify-content: center;
    width: 24px; height: 22px; border-radius: 4px; color: #ccc;
    font-size: 11px; text-decoration: none; }
  .toolbar a:hover { background: rgba(255, 255, 255, 0.15); color: #fff; }
  .row { display: flex; align-items: center; gap: 10px; flex: 0 0 auto; }
  img.art { width: 78px; height: 78px; border-radius: 6px; object-fit: cover;
    background: #212121; flex-shrink: 0; }
  .meta { flex: 1; min-width: 0; display: flex; flex-direction: column;
    justify-content: center; gap: 2px; }
  .title { font-size: 14px; font-weight: 600; white-space: nowrap;
    text-overflow: ellipsis; overflow: hidden; }
  .artist { font-size: 12px; color: #aaa; white-space: nowrap;
    text-overflow: ellipsis; overflow: hidden; }
  .controls { display: flex; gap: 6px; margin-top: 4px;
    -webkit-app-region: no-drag; }
  .controls a { display: flex; align-items: center; justify-content: center;
    width: 34px; height: 30px; border-radius: 4px; color: #fff;
    font-size: 15px; text-decoration: none; }
  .controls a:hover { background: rgba(255, 255, 255, 0.12); }
  .controls a.play { width: 40px; background: rgba(255, 255, 255, 0.1);
    font-size: 17px; }
  .lyrics { display: none; flex-direction: column; flex: 1 1 auto;
    min-height: 0; overflow-y: auto; scrollbar-width: none; padding: 6px 2px 2px;
    margin-top: 8px;
    -webkit-app-region: no-drag; }
  .lyrics::-webkit-scrollbar { display: none; }
  .lyrics .state { margin: auto; color: #777; font-size: 12px;
    font-style: italic; }
  .lyrics .line { padding: 3px 6px; border-radius: 4px; cursor: pointer;
    opacity: 0.4; transition: opacity 0.3s; }
  .lyrics .line:hover { background: rgba(255, 255, 255, 0.08); }
  .lyrics .line.active { opacity: 1; }
  .lyrics .orig { font-size: calc(12px * var(--lyr-scale, 1)); font-weight: 400;
    color: var(--lyr-color, #fff);
    white-space: normal; word-break: break-word;
    transition: font-size 0.2s ease; }
  .lyrics .line.active .orig {
    font-size: calc(12px * var(--lyr-scale, 1) * var(--lyr-em, 1.25));
    font-weight: 600; }
  body.em-none .lyrics .line.active .orig { font-weight: 400; }
  .lyrics .rom { font-size: calc(10px * var(--lyr-scale, 1)); font-style: italic;
    color: #bbb;
    white-space: normal; word-break: break-word; }
  body.hide-meta .art, body.hide-meta .title, body.hide-meta .artist {
    display: none; }
  body.hide-meta .lyrics { padding-top: 26px; }
  body.hide-lyrics .lyrics { display: none !important; }
  .progress-wrap { -webkit-app-region: no-drag; cursor: pointer;
    padding: 6px 0 2px; margin-top: auto; }
  .progress { height: 4px; border-radius: 2px; background: #3a3a3a;
    position: relative; }
  .progress .fill { position: absolute; inset: 0 auto 0 0; width: 0%;
    border-radius: 2px; background: #ff0033; }
  .time { display: flex; justify-content: space-between; align-items: center;
    gap: 8px; font-size: 10px;
    color: #999; margin-top: 6px; font-variant-numeric: tabular-nums; }
  .time .controls { margin-top: 0; }
  .time .controls a { width: 32px; height: 28px; font-size: 16px; }
  .time .duration { margin-left: auto; }
  body.hide-meta .row { display: none; }
</style>
</head>
<body>
  <div class="drag-handle" title="Drag to move window">&#10022;</div>
  <div class="toolbar">
    <a href="minip://font-dec" title="Smaller lyrics">A&#8722;</a>
    <a href="minip://font-inc" title="Bigger lyrics">A+</a>
    <a href="minip://emph-cycle" title="Cycle lyrics emphasis (None/Subtle/Normal/Strong)">&#8645;</a>
    <a href="minip://toggle-meta" title="Show/hide album art and song info">&#9432;</a>
    <a href="minip://toggle-lyrics" title="Show/hide lyrics">&#9835;</a>
    <a href="minip://toggle-transparent" title="Transparent background">&#9744;</a>
    <a href="minip://show-main" title="Switch to main player">&#9635;</a>
  </div>
  <div class="row">
    <img class="art" id="art" alt="">
    <div class="meta" id="metaRow">
      <div class="title" id="title">YouTube Music</div>
      <div class="artist" id="artist"></div>
      <div class="controls">
        <a href="minip://prev" title="Previous">&#9198;</a>
        <a href="minip://toggle" class="play" id="play" title="Play/Pause">&#9654;</a>
        <a href="minip://next" title="Next">&#9197;</a>
      </div>
    </div>
  </div>
  <div class="lyrics" id="lyrics"></div>
  <div class="progress-wrap">
    <div class="progress" id="progressBar"><div class="fill" id="fill"></div></div>
    <div class="time" id="timeRow"><span id="elapsed">0:00</span><span id="duration" class="duration">0:00</span></div>
  </div>
<script>
  const fmt = (s) => {
    if (!Number.isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60), r = Math.floor(s % 60);
    return m + ':' + String(r).padStart(2, '0');
  };
  const $ = (id) => document.getElementById(id);
  let duration = 0;
  let elapsedSec = 0;
  let lines = [];
  let activeIdx = -2;
  let lastMinHeight = 0;
  const cssVar = (name, fallback) => {
    const v = parseFloat(document.body.style.getPropertyValue(name));
    return Number.isFinite(v) ? v : fallback;
  };
  const updateMinHeight = () => {
    requestAnimationFrame(() => {
      const row = document.querySelector('.row');
      const prog = document.querySelector('.progress-wrap');
      const lyricsEl = $('lyrics');
      let h = 20; // body padding
      if (row && row.offsetParent !== null) h += row.offsetHeight;
      if (prog) h += prog.offsetHeight;
      const lyricsShown =
        !document.body.classList.contains('hide-lyrics') &&
        lyricsEl &&
        lyricsEl.style.display !== 'none';
      if (lyricsShown) {
        const scale = cssVar('--lyr-scale', 1);
        const em = cssVar('--lyr-em', 1.25);
        // active line (orig + romaji) + container padding
        h += 12 * scale * em * 1.45 + 10 * scale * 1.4 * 2 + 14;
      }
      h = Math.max(110, Math.round(h));
      if (h !== lastMinHeight) {
        lastMinHeight = h;
        location.href = 'minip://minheight/' + h;
      }
    });
  };
  const buildList = () => {
    const el = $('lyrics');
    el.innerHTML = '';
    for (const line of lines) {
      const div = document.createElement('div');
      div.className = 'line';
      div.dataset.time = String(line.timeInMs);
      const orig = document.createElement('div');
      orig.className = 'orig';
      orig.textContent = line.text || '\\u266A';
      div.appendChild(orig);
      if (line.romaji) {
        const rom = document.createElement('div');
        rom.className = 'rom';
        rom.textContent = line.romaji;
        div.appendChild(rom);
      }
      el.appendChild(div);
    }
  };
  const render = () => {
    if (!lines.length) return;
    const t = elapsedSec * 1000;
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].timeInMs <= t) idx = i; else break;
    }
    if (idx === activeIdx) return;
    activeIdx = idx;
    const children = $('lyrics').children;
    for (let i = 0; i < children.length; i++) {
      children[i].classList.toggle('active', i === idx);
    }
    const cur = children[idx];
    if (cur) cur.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  window.__update = (info) => {
    if (info.title !== undefined) $('title').textContent = info.title;
    if (info.artist !== undefined) $('artist').textContent = info.artist;
    if (info.imageSrc !== undefined) $('art').src = info.imageSrc || '';
    if (info.isPaused !== undefined) {
      $('play').innerHTML = info.isPaused ? '&#9654;' : '&#9208;';
    }
    if (info.duration !== undefined) {
      duration = info.duration;
      $('duration').textContent = fmt(duration);
    }
    if (info.lyrics !== undefined) {
      const lyr = info.lyrics || {};
      const el = $('lyrics');
      el.innerHTML = '';
      activeIdx = -2;
      el.style.display = 'flex';
      if (lyr.state === 'lines' && lyr.lines && lyr.lines.length) {
        lines = lyr.lines;
        buildList();
        render();
      } else {
        lines = [];
        const msg = document.createElement('div');
        msg.className = 'state';
        msg.textContent =
          lyr.state === 'loading'
            ? 'Loading lyrics\\u2026'
            : 'No lyrics found';
        el.appendChild(msg);
      }
      updateMinHeight();
    }
    if (info.scale !== undefined) {
      document.body.style.setProperty('--lyr-scale', String(info.scale));
      updateMinHeight();
    }
    if (info.em !== undefined) {
      document.body.style.setProperty('--lyr-em', String(info.em));
      updateMinHeight();
    }
    if (info.emphasis !== undefined) {
      document.body.classList.toggle(
        'em-none',
        info.emphasis === 'none',
      );
    }
    if (info.color !== undefined) {
      document.body.style.setProperty('--lyr-color', String(info.color));
    }
    if (info.hideMeta !== undefined) {
      const hide = !!info.hideMeta;
      document.body.classList.toggle('hide-meta', hide);
      const controls = document.querySelector('.controls');
      const target = hide ? $('timeRow') : $('metaRow');
      if (controls && target && controls.parentElement !== target) {
        if (hide) {
          target.insertBefore(controls, target.children[1] ?? null);
        } else {
          target.appendChild(controls);
        }
      }
      updateMinHeight();
    }
    if (info.showLyrics !== undefined) {
      document.body.classList.toggle('hide-lyrics', !info.showLyrics);
      updateMinHeight();
    }
    if (info.transparent !== undefined) {
      document.body.classList.toggle('transparent', !!info.transparent);
    }
    if (info.elapsed !== undefined) {
      elapsedSec = info.elapsed;
      $('elapsed').textContent = fmt(elapsedSec);
      $('fill').style.width =
        duration > 0 ? Math.min(100, (elapsedSec / duration) * 100) + '%' : '0%';
      render();
    }
  };
  $('progressBar').addEventListener('click', (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    if (duration > 0) location.href = 'minip://seek/' + Math.round(ratio * duration);
  });
  $('lyrics').addEventListener('click', (e) => {
    const line = e.target.closest('.line');
    if (line) {
      location.href =
        'minip://seek/' + Math.round(Number(line.dataset.time) / 1000);
    }
  });
</script>
</body>
</html>`;

let miniWindow: BrowserWindow | null = null;
let mainWindow: BrowserWindow | null = null;
let miniLyrics: { state: string; lines?: unknown[] } | null = null;
let songControls: ReturnType<typeof getSongControls> | null = null;
let getConfigRef:
  | (() => Promise<MiniPlayerPluginConfig> | MiniPlayerPluginConfig)
  | null = null;
let setConfigRef:
  | ((config: Partial<Omit<MiniPlayerPluginConfig, 'enabled'>>) => unknown)
  | null = null;
let lastInfo: SongInfo | null = null;
let lastElapsed = 0;
let lastElapsedAt = Date.now();
let playing = false;
let showLyricsAreaRef = true;
let lastMinHeight = 110;
let progressTimer: ReturnType<typeof setInterval> | null = null;
let mainWindowMinimizedByMini = false;
const unregisterSongInfo = new Set<() => void>();
let runToken = 0;
let backendIpc: BackendContext<MiniPlayerPluginConfig>['ipc'] | null = null;
let saveBoundsTimer: ReturnType<typeof setTimeout> | null = null;

const onMiniLyrics = (payload: { state: string; lines?: unknown[] }) => {
  miniLyrics = payload;
  push({ lyrics: payload });
  resizeForLyrics();
};

const getElapsed = () => {
  if (!playing) return lastElapsed;
  const delta = (Date.now() - lastElapsedAt) / 1000;
  return lastElapsed + delta;
};

const push = (payload: Record<string, unknown>) => {
  if (!miniWindow || miniWindow.isDestroyed()) return;
  miniWindow.webContents
    .executeJavaScript(`window.__update(${JSON.stringify(payload)})`, true)
    .catch(() => {});
};

const pushAll = () => {
  if (!lastInfo) return;
  push({
    title: lastInfo.title,
    artist: lastInfo.artist,
    imageSrc: lastInfo.imageSrc ?? '',
    isPaused: !playing,
    duration: lastInfo.songDuration,
    elapsed: getElapsed(),
  });
  if (miniLyrics) {
    push({ lyrics: miniLyrics });
  }
};

const resizeForLyrics = () => {
  if (!miniWindow || miniWindow.isDestroyed()) return;
  const [width, height] = miniWindow.getSize();
  const target =
    miniLyrics && showLyricsAreaRef ? MINI_HEIGHT_LYRICS : MINI_HEIGHT;
  // only snap when sitting at the minimum height; user-resized
  // windows keep their height
  if (height <= lastMinHeight + 1 && height !== target) {
    miniWindow.setSize(width, target);
  }
};

const clampScale = (value: number) =>
  Math.min(1.8, Math.max(0.7, Math.round(value * 10) / 10));

const emphasisMultipliers: Record<string, number> = {
  none: 1,
  subtle: 1.1,
  normal: 1.25,
  strong: 1.4,
};

const pushStyle = (config: MiniPlayerPluginConfig) => {
  push({
    scale: config.lyricsScale ?? 1,
    hideMeta: config.hideMeta ?? false,
    showLyrics: config.showLyricsArea ?? true,
    transparent: config.transparentBg ?? false,
    color: config.lyricsColor ?? '#ffffff',
    em: emphasisMultipliers[config.lyricsEmphasis ?? 'normal'] ?? 1.25,
    emphasis: config.lyricsEmphasis ?? 'normal',
  });
};

const onMainRestored = () => {
  // exclusive windows: main window restored -> close mini player
  if (miniWindow) {
    setConfigRef?.({ visible: false });
  }
};

const stopProgressTimer = () => {
  if (progressTimer) {
    clearInterval(progressTimer);
    progressTimer = null;
  }
};

const restoreMainWindow = () => {
  if (!mainWindowMinimizedByMini) return;
  mainWindowMinimizedByMini = false;
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isMinimized()) {
    mainWindow.restore();
  }
};

const closeWindow = () => {
  stopProgressTimer();
  const win = miniWindow;
  miniWindow = null;
  if (win && !win.isDestroyed()) {
    win.destroy();
  }
  restoreMainWindow();
};

const createWindow = async (config: MiniPlayerPluginConfig) => {
  if (!songControls) return;
  showLyricsAreaRef = config.showLyricsArea ?? true;

  const win = new BrowserWindow({
    width: config.bounds?.width ?? MINI_WIDTH,
    height:
      config.bounds?.height ?? (miniLyrics ? MINI_HEIGHT_LYRICS : MINI_HEIGHT),
    x: config.bounds?.x,
    y: config.bounds?.y,
    frame: false,
    resizable: true,
    minWidth: 280,
    minHeight: 110,
    maximizable: false,
    fullscreenable: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: config.alwaysOnTop ?? true,
    show: false,
    title: 'Mini Player',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  miniWindow = win;

  win.removeMenu();

  // persist window size/position (debounced) across restarts
  const saveBounds = () => {
    if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
    saveBoundsTimer = setTimeout(() => {
      saveBoundsTimer = null;
      if (miniWindow === win && !win.isDestroyed()) {
        const [x, y] = win.getPosition();
        const [width, height] = win.getSize();
        setConfigRef?.({ bounds: { x, y, width, height } });
      }
    }, 500);
  };
  win.on('resize', saveBounds);
  win.on('move', saveBounds);

  const controls = songControls;
  const actions: Record<string, () => void> = {
    'minip://prev': controls.previous,
    'minip://next': controls.next,
    'minip://toggle': controls.playPause,
    'minip://show-main': () => {
      if (!mainWindow) return;
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      } else {
        mainWindow.show();
      }
      mainWindow.focus();
      // close the mini player via config so both windows never stay open
      setConfigRef?.({ visible: false });
    },
    'minip://font-inc': () => {
      Promise.resolve(getConfigRef?.() ?? { lyricsScale: 1 }).then((conf) => {
        setConfigRef?.({
          lyricsScale: clampScale((conf.lyricsScale ?? 1) + 0.1),
        });
      });
    },
    'minip://font-dec': () => {
      Promise.resolve(getConfigRef?.() ?? { lyricsScale: 1 }).then((conf) => {
        setConfigRef?.({
          lyricsScale: clampScale((conf.lyricsScale ?? 1) - 0.1),
        });
      });
    },
    'minip://toggle-meta': () => {
      Promise.resolve(getConfigRef?.() ?? { hideMeta: false }).then((conf) => {
        setConfigRef?.({ hideMeta: !(conf.hideMeta ?? false) });
      });
    },
    'minip://toggle-lyrics': () => {
      Promise.resolve(getConfigRef?.() ?? { showLyricsArea: true }).then(
        (conf) => {
          setConfigRef?.({ showLyricsArea: !(conf.showLyricsArea ?? true) });
        },
      );
    },
    'minip://emph-cycle': () => {
      Promise.resolve(getConfigRef?.() ?? { lyricsEmphasis: 'normal' }).then(
        (conf) => {
          const order: MiniPlayerPluginConfig['lyricsEmphasis'][] = [
            'none',
            'subtle',
            'normal',
            'strong',
          ];
          const current = conf.lyricsEmphasis ?? 'normal';
          const next =
            order[(order.indexOf(current) + 1) % order.length] ?? 'normal';
          setConfigRef?.({ lyricsEmphasis: next });
        },
      );
    },
    'minip://toggle-transparent': () => {
      Promise.resolve(getConfigRef?.() ?? { transparentBg: false }).then(
        (conf) => {
          setConfigRef?.({ transparentBg: !(conf.transparentBg ?? false) });
        },
      );
    },
  };

  const handleAction = (url: string) => {
    if (actions[url]) {
      actions[url]();
      return;
    }
    if (url.startsWith('minip://seek/')) {
      const seconds = Number(url.slice('minip://seek/'.length));
      if (Number.isFinite(seconds) && seconds >= 0) {
        controls.seekTo(seconds);
      }
      return;
    }
    if (url.startsWith('minip://minheight/')) {
      const height = Number(url.slice('minip://minheight/'.length));
      if (Number.isFinite(height) && height > 0 && miniWindow) {
        const current = miniWindow;
        const [, currentHeight] = current.getSize();
        const wasAtMinimum = currentHeight <= lastMinHeight + 1;
        const rounded = Math.round(height);
        current.setMinimumSize(280, rounded);
        lastMinHeight = rounded;
        // only snap height when window was sitting at its minimum;
        // user-resized windows keep their height
        if (wasAtMinimum) {
          resizeForLyrics();
        }
      }
    }
  };

  win.webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    handleAction(url);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    handleAction(url);
    return { action: 'deny' };
  });

  win.on('closed', () => {
    if (miniWindow !== win) return;
    miniWindow = null;
    if (saveBoundsTimer) {
      clearTimeout(saveBoundsTimer);
      saveBoundsTimer = null;
    }
    stopProgressTimer();
    restoreMainWindow();
    setConfigRef?.({ visible: false });
  });

  try {
    await win.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(pageHtml)}`,
    );
  } catch {
    if (miniWindow === win) {
      miniWindow = null;
      win.destroy();
      setConfigRef?.({ visible: false });
    }
    return;
  }

  if (miniWindow !== win || win.isDestroyed()) return;
  win.show();
  // exclusive windows: mini player visible -> minimize main window
  if (mainWindow && !mainWindow.isMinimized()) {
    mainWindow.minimize();
    mainWindowMinimizedByMini = true;
  }
  progressTimer ??= setInterval(() => {
    if (lastInfo) push({ elapsed: getElapsed() });
  }, 1000);
  pushAll();
  pushStyle(config);
};

export const backend = createBackend({
  start({
    window,
    getConfig,
    setConfig,
    ipc,
  }: BackendContext<MiniPlayerPluginConfig>) {
    const token = ++runToken;
    songControls = getSongControls(window);
    mainWindow = window;
    getConfigRef = getConfig;
    setConfigRef = setConfig;
    backendIpc = ipc;

    window.on('restore', onMainRestored);

    ipc.on('synced-lyrics:mini-lyrics', onMiniLyrics);

    unregisterSongInfo.add(
      registerCallback((songInfo, event) => {
        lastInfo = songInfo;

        if (event === SongInfoEvent.PlayOrPaused) {
          playing = !songInfo.isPaused;
          lastElapsed = songInfo.elapsedSeconds ?? lastElapsed;
          lastElapsedAt = Date.now();
          push({ isPaused: !playing });
        } else if (event === SongInfoEvent.VideoSrcChanged) {
          playing = !songInfo.isPaused;
          lastElapsed = songInfo.elapsedSeconds ?? 0;
          lastElapsedAt = Date.now();
          miniLyrics = { state: 'loading' };
          pushAll();
        } else if (event === SongInfoEvent.TimeChanged) {
          lastElapsed = songInfo.elapsedSeconds ?? lastElapsed;
          lastElapsedAt = Date.now();
          push({ elapsed: lastElapsed });
        }
      }),
    );

    Promise.resolve(getConfig()).then((config) => {
      // ignore a start that raced a stop/disable in between
      if (token === runToken && config.visible) {
        createWindow(config);
      }
    });
  },

  onConfigChange(newConfig) {
    const lyricsAreaToggled =
      showLyricsAreaRef !== (newConfig.showLyricsArea ?? true);
    showLyricsAreaRef = newConfig.showLyricsArea ?? true;

    if (newConfig.visible && !miniWindow) {
      createWindow(newConfig);
    } else if (!newConfig.visible && miniWindow) {
      closeWindow();
    }

    if (miniWindow && !miniWindow.isDestroyed()) {
      miniWindow.setAlwaysOnTop(newConfig.alwaysOnTop ?? true);
    }

    if (lyricsAreaToggled) {
      resizeForLyrics();
    }

    pushStyle(newConfig);
  },

  stop() {
    runToken++;
    for (const unregister of unregisterSongInfo) unregister();
    unregisterSongInfo.clear();
    backendIpc?.removeListener('synced-lyrics:mini-lyrics', onMiniLyrics);
    backendIpc = null;
    mainWindow?.removeListener('restore', onMainRestored);
    closeWindow();
    mainWindow = null;
    songControls = null;
    getConfigRef = null;
    setConfigRef = null;
    lastInfo = null;
    miniLyrics = null;
    lastMinHeight = 110;
  },
});
