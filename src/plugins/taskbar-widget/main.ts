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

import type { TaskbarWidgetPluginConfig, VisualizerPosition } from './index';

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
const REPOSITION_INTERVAL_MS = 100;
// Every FORCE_ZORDER_EVERY_N_TICKS repositions, the always-on-top flag is
// toggled off then back on (hidden behind an opacity:0 guard to prevent
// visible flicker).  This forces Windows to re-evaluate the widget's
// position in the TOPMOST z-band.
const FORCE_ZORDER_EVERY_N_TICKS = 30; // ~3 s when REPOSITION_INTERVAL_MS=100
// When the widget is hidden externally (e.g. Start menu opens), an aggressive
// recovery interval fires every HIDE_RECOVERY_INTERVAL_MS for up to
// HIDE_RECOVERY_DURATION_MS.  This covers both fast transitions (clicking a
// pinned taskbar icon) and slower system overlay animations (Start menu).
const HIDE_RECOVERY_INTERVAL_MS = 100;
const HIDE_RECOVERY_DURATION_MS = 3000;

let miniPlayerWin: BrowserWindow | null = null;
// Visualizer window – sits adjacent to the mini player widget.
let visualizerWin: BrowserWindow | null = null;
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
// Visualizer configuration state
let visualizerEnabled = false;
let visualizerPosition: VisualizerPosition = 'left';
let visualizerBarCount = 20;
let visualizerCenteredBars = true;
let visualizerShowBaseline = true;
let visualizerAudioSensitivity = 0.3;
let visualizerAudioPeakThreshold = 0.85;
let visualizerWidth = 84;
let blurOpacity = 0.5;
// IPC handler for audio data forwarding from renderer to visualizer
let audioDataHandler:
  | ((_: Electron.IpcMainEvent, data: number[]) => void)
  | null = null;
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
// Tick counter for the periodic reposition timer.
let repositionTickCount = 0;
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
const ALLOWED_SEND = ['taskbar-widget:control', 'taskbar-widget:resize', 'taskbar-widget:show-window', 'taskbar-widget:audio-data'];
const ALLOWED_RECEIVE = ['taskbar-widget:song-info', 'taskbar-widget:set-blur', 'taskbar-widget:set-blur-opacity', 'taskbar-widget:set-background-color', 'taskbar-widget:visualizer-config', 'taskbar-widget:audio-data'];
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
  const albumSize = Math.max(widgetHeight - 16, 24);
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
      display: flex;
      align-items: center;
    }
    .container {
      display: inline-flex;
      align-items: center;
      padding: ${containerPadding};
      gap: 8px;
      cursor: pointer;
    }
    .container.blur-bg {
      background: var(--dynamic-bg, rgba(0, 0, 0, var(--blur-opacity, 0.5)));
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border-radius: 4px;
      border: 1px solid rgba(255, 255, 255, 0.12);
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
    .artist .year {
      font-size: ${Math.max(artistFontSize - 2, 8)}px;
      color: rgba(255, 255, 255, 0.4);
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
        // Show artist with optional year in smaller text
        if (info.year) {
          artist.innerHTML = (info.artist || '') + ' <span class="year">(' + info.year + ')</span>';
        } else {
          artist.textContent = info.artist || '';
        }
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

    window.widgetIpc.on('taskbar-widget:set-blur-opacity', (opacity) => {
      if (typeof opacity === 'number') {
        document.documentElement.style.setProperty('--blur-opacity', String(opacity));
        // Also update dynamic-bg gradient if it was previously set
        const current = player.style.getPropertyValue('--dynamic-bg');
        if (current) {
          // Re-apply the stored color with new opacity
          player.dispatchEvent(new CustomEvent('update-opacity'));
        }
      }
    });

    let storedColor = null;
    const getOpacity = () => {
      const val = getComputedStyle(document.documentElement).getPropertyValue('--blur-opacity').trim();
      return val ? parseFloat(val) : 0.5;
    };

    window.widgetIpc.on('taskbar-widget:set-background-color', (color) => {
      if (color && color.r !== undefined) {
        storedColor = color;
        const opacity = getOpacity();
        const dr = Math.max(0, color.r - 40);
        const dg = Math.max(0, color.g - 40);
        const db = Math.max(0, color.b - 40);
        const gradient = 'linear-gradient(135deg, rgba(' + color.r + ',' + color.g + ',' + color.b + ',' + (opacity * 0.7) + '), rgba(' + dr + ',' + dg + ',' + db + ',' + (opacity * 0.9) + '))';
        player.style.setProperty('--dynamic-bg', gradient);
      }
    });

    player.addEventListener('update-opacity', () => {
      if (storedColor) {
        const opacity = getOpacity();
        const dr = Math.max(0, storedColor.r - 40);
        const dg = Math.max(0, storedColor.g - 40);
        const db = Math.max(0, storedColor.b - 40);
        const gradient = 'linear-gradient(135deg, rgba(' + storedColor.r + ',' + storedColor.g + ',' + storedColor.b + ',' + (opacity * 0.7) + '), rgba(' + dr + ',' + dg + ',' + db + ',' + (opacity * 0.9) + '))';
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
 * Generate the HTML for the audio visualizer window.
 * Renders vertical bars on a canvas that react to audio frequency data.
 */
const getVisualizerHTML = (widgetHeight: number): string => {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: transparent;
      overflow: hidden;
      height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    canvas {
      display: block;
      width: 100%;
      height: ${widgetHeight}px;
    }
  </style>
</head>
<body>
  <canvas id="visualizer"></canvas>
  <script>
    const canvas = document.getElementById('visualizer');
    const ctx = canvas.getContext('2d');

    // Configuration – updated via IPC
    let barCount = ${visualizerBarCount};
    let centeredBars = ${visualizerCenteredBars};
    let showBaseline = ${visualizerShowBaseline};
    let audioSensitivity = ${visualizerAudioSensitivity};
    let audioPeakThreshold = ${visualizerAudioPeakThreshold};

    // Current and smoothed frequency data (FluentFlyout-style bar values)
    let smoothedData = new Array(barCount).fill(0);

    // Dynamic color from album art
    let barColorR = 120, barColorG = 180, barColorB = 255;

    // High-DPI canvas scaling
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    };
    resize();
    window.addEventListener('resize', resize);

    // Raw frequency data from IPC
    let rawFreqData = [];

    window.widgetIpc.on('taskbar-widget:audio-data', (data) => {
      if (!Array.isArray(data)) return;
      rawFreqData = data;
    });

    window.widgetIpc.on('taskbar-widget:visualizer-config', (config) => {
      if (config.barCount !== undefined) {
        barCount = config.barCount;
        smoothedData = new Array(barCount).fill(0);
      }
      if (config.centeredBars !== undefined) centeredBars = config.centeredBars;
      if (config.showBaseline !== undefined) showBaseline = config.showBaseline;
      if (config.audioSensitivity !== undefined) audioSensitivity = config.audioSensitivity;
      if (config.audioPeakThreshold !== undefined) audioPeakThreshold = config.audioPeakThreshold;
    });

    window.widgetIpc.on('taskbar-widget:set-background-color', (color) => {
      if (color && color.r !== undefined) {
        barColorR = Math.min(255, color.r + 60);
        barColorG = Math.min(255, color.g + 60);
        barColorB = Math.min(255, color.b + 60);
      }
    });

    const draw = () => {
      requestAnimationFrame(draw);
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;

      ctx.clearRect(0, 0, w, h);

      const gap = 2;
      const totalGap = gap * (barCount - 1);
      const barWidth = Math.max(1, (w - totalGap) / barCount);

      // ── FluentFlyout-style frequency processing ──
      // Port of FluentFlyout's ProcessFftData() from Visualizer.cs.
      //
      // Input: rawFreqData is byte frequency data (0-255) from Web Audio
      // AnalyserNode.getByteFrequencyData().  Each byte encodes magnitude
      // in dB mapped to 0-255 where 0 = minDecibels (-100 dB) and
      // 255 = maxDecibels (-30 dB).
      //
      // Steps (matching FluentFlyout):
      // 1. Logarithmic frequency band mapping (40 Hz – 8000 Hz)
      // 2. Max amplitude per band (not average)
      // 3. Linear boost for higher-frequency bars
      // 4. dB-scale intensity mapping between configurable min/max dB
      // 5. Asymmetric smoothing: instant attack, 0.8/0.2 weighted decay

      const dataLen = rawFreqData.length;
      if (dataLen === 0) {
        // No data yet - just decay existing bars
        for (let i = 0; i < barCount; i++) {
          smoothedData[i] *= 0.8;
        }
      } else {
        // Assume 44100 Hz sample rate; fftSize = dataLen * 2
        const sampleRate = 44100;
        const fftSize = dataLen * 2;
        const frequencyPerBin = sampleRate / fftSize;

        const minFreq = 40;    // Hz - low end
        const maxFreq = 8000;  // Hz - high end (FluentFlyout default)

        // Map our audioSensitivity (0.01-1.0, default 0.3) and
        // audioPeakThreshold (0.1-1.0, default 0.85) to FluentFlyout's
        // dB range.  FluentFlyout uses integer 1-3  for both settings:
        //   minDb = (sens * -10) - 30   -> default sens=2 -> -50
        //   maxDb = (peak *  10) - 30   -> default peak=2 -> -10
        // We scale our float ranges to produce comparable dB values.
        const ffSens = 1 + audioSensitivity * 6.67; // 0.3 -> ~3 -> minDb -60
        const ffPeak = 1 + audioPeakThreshold * 2.35; // 0.85 -> ~3 -> maxDb  0
        const minDb = (ffSens * -10) - 30;
        const maxDb = (ffPeak * 10) - 30;

        const currentBars = new Array(barCount);

        for (let i = 0; i < barCount; i++) {
          // Logarithmic frequency band edges (FluentFlyout)
          const startFreq = minFreq * Math.pow(maxFreq / minFreq, i / barCount);
          const endFreq   = minFreq * Math.pow(maxFreq / minFreq, (i + 1) / barCount);

          let startBin = Math.floor(startFreq / frequencyPerBin);
          let endBin   = Math.floor(endFreq / frequencyPerBin);
          if (endBin <= startBin) endBin = startBin + 1;
          if (endBin >= dataLen) endBin = dataLen - 1;

          // Find MAX amplitude in the band (FluentFlyout uses max, not avg)
          // Convert byte -> linear amplitude first.
          // Byte 0..255 maps to -100..-30 dB in Web Audio default.
          let maxAmplitude = 0;
          for (let j = startBin; j <= endBin; j++) {
            const byteVal = rawFreqData[j] || 0;
            // Convert byte to dB: db = (byte/255)*70 - 100
            const dbVal = (byteVal / 255) * 70 - 100;
            // Convert dB to linear amplitude
            const amp = Math.pow(10, dbVal / 20);
            if (amp > maxAmplitude) maxAmplitude = amp;
          }

          // Linear boost for higher-frequency bars (FluentFlyout: 1 + progress * 75)
          const progress = i / barCount;
          const linearBoost = 1.0 + (progress * 75.0);
          maxAmplitude *= linearBoost;

          // Floor to avoid log(0)
          if (maxAmplitude < 0.001) maxAmplitude = 0.001;

          // Convert back to dB
          const db = 20 * Math.log10(maxAmplitude);

          // Map to 0..1 intensity within [minDb, maxDb]
          let intensity = (db - minDb) / (maxDb - minDb);
          intensity = Math.max(0, Math.min(1, intensity));

          currentBars[i] = intensity;
        }

        // FluentFlyout smoothing: instant attack, 0.8/0.2 weighted decay
        for (let i = 0; i < barCount; i++) {
          if (currentBars[i] > smoothedData[i]) {
            // Jump up quickly (FluentFlyout: instant)
            smoothedData[i] = currentBars[i];
          } else {
            // Fall down slowly (FluentFlyout: 0.8 old + 0.2 new)
            smoothedData[i] = (smoothedData[i] * 0.8) + (currentBars[i] * 0.2);
          }
        }
      }

      for (let i = 0; i < barCount; i++) {
        const x = i * (barWidth + gap);
        const barHeight = Math.max(0, smoothedData[i] * h);

        // Gradient for each bar
        const alpha = 0.5 + smoothedData[i] * 0.5;
        const gradTop = 'rgba(' + barColorR + ',' + barColorG + ',' + barColorB + ',' + alpha + ')';
        const gradBot = 'rgba(' + barColorR + ',' + barColorG + ',' + barColorB + ',' + (alpha * 0.3) + ')';

        if (centeredBars) {
          // Bars expand from center
          const halfBar = barHeight / 2;
          const yTop = (h / 2) - halfBar;

          const grad = ctx.createLinearGradient(x, yTop, x, yTop + barHeight);
          grad.addColorStop(0, gradBot);
          grad.addColorStop(0.5, gradTop);
          grad.addColorStop(1, gradBot);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.roundRect(x, yTop, barWidth, barHeight, 1);
          ctx.fill();
        } else {
          // Bars rise from bottom
          const y = h - barHeight;
          const grad = ctx.createLinearGradient(x, y, x, h);
          grad.addColorStop(0, gradTop);
          grad.addColorStop(1, gradBot);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.roundRect(x, y, barWidth, barHeight, 1);
          ctx.fill();
        }
      }

      // Baseline
      if (showBaseline) {
        ctx.strokeStyle = 'rgba(' + barColorR + ',' + barColorG + ',' + barColorB + ', 0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (centeredBars) {
          ctx.moveTo(0, h / 2);
          ctx.lineTo(w, h / 2);
        } else {
          ctx.moveTo(0, h - 0.5);
          ctx.lineTo(w, h - 0.5);
        }
        ctx.stroke();
      }
    };

    draw();
  </script>
</body>
</html>`;
};

const writeVisualizerHtmlFile = (widgetHeight: number): string => {
  const htmlPath = path.join(getWidgetDir(), 'visualizer.html');
  fs.writeFileSync(htmlPath, getVisualizerHTML(widgetHeight));
  return htmlPath;
};

/**
 * Calculate the bounds for the visualizer window, positioned adjacent
 * to the mini player widget.
 */
const getVisualizerBounds = () => {
  const widgetBounds = getWidgetBounds();
  const vizWidth = visualizerWidth;

  return {
    x:
      visualizerPosition === 'left'
        ? widgetBounds.x - vizWidth - 4
        : widgetBounds.x + widgetBounds.width + 4,
    y: widgetBounds.y,
    width: vizWidth,
    height: widgetBounds.height,
  };
};

/** Create or destroy the visualizer window based on config. */
const ensureVisualizerWindow = async (preloadPath: string) => {
  if (visualizerEnabled && isShowing) {
    if (!visualizerWin || visualizerWin.isDestroyed()) {
      const bounds = getVisualizerBounds();
      const htmlPath = writeVisualizerHtmlFile(bounds.height);

      visualizerWin = new BrowserWindow({
        ...bounds,
        frame: false,
        transparent: true,
        skipTaskbar: true,
        resizable: false,
        movable: false,
        focusable: false,
        show: false,
        type: 'toolbar',
        webPreferences: {
          contextIsolation: true,
          preload: preloadPath,
        },
      });

      visualizerWin.setAlwaysOnTop(true, 'screen-saver');
      await visualizerWin.loadFile(htmlPath);
      visualizerWin.setIgnoreMouseEvents(true, { forward: true });
      visualizerWin.showInactive();

      // Forward hide/minimize recovery
      visualizerWin.on('hide', () => {
        if (
          isShowing &&
          !intentionalClose &&
          visualizerWin &&
          !visualizerWin.isDestroyed()
        ) {
          visualizerWin.showInactive();
          visualizerWin.setAlwaysOnTop(true, 'screen-saver');
        }
      });
      visualizerWin.on('minimize', () => {
        if (
          isShowing &&
          !intentionalClose &&
          visualizerWin &&
          !visualizerWin.isDestroyed()
        ) {
          visualizerWin.restore();
        }
      });
    } else {
      // Update position
      const bounds = getVisualizerBounds();
      visualizerWin.setBounds(bounds);
    }
  } else if (visualizerWin && !visualizerWin.isDestroyed()) {
    visualizerWin.close();
    visualizerWin = null;
  }
};

/** Reposition the visualizer window alongside the main widget. */
const repositionVisualizer = () => {
  if (!visualizerWin || visualizerWin.isDestroyed()) return;
  const bounds = getVisualizerBounds();
  visualizerWin.setBounds(bounds);
  if (isShowing && !intentionalClose) {
    visualizerWin.moveTop();
  }
};

/** Send current visualizer config to the visualizer renderer. */
const sendVisualizerConfig = () => {
  if (!visualizerWin || visualizerWin.isDestroyed()) return;
  visualizerWin.webContents.send('taskbar-widget:visualizer-config', {
    barCount: visualizerBarCount,
    centeredBars: visualizerCenteredBars,
    showBaseline: visualizerShowBaseline,
    audioSensitivity: visualizerAudioSensitivity,
    audioPeakThreshold: visualizerAudioPeakThreshold,
  });
};

/**
 * Extract the dominant color from an album art URL using Electron's
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
      // Skip very dark / very bright pixels for a more representative color
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
 * Reposition the widget and periodically reassert z-order.
 * Called on display changes and periodically to handle auto-hide taskbar
 * and z-index loss from window focus changes.
 *
 * Every {@link FORCE_ZORDER_EVERY_N_TICKS} ticks the always-on-top flag is
 * toggled off then on (wrapped in an opacity guard to prevent visible
 * flicker) to force the OS to re-evaluate the TOPMOST z-band.  On
 * intermediate ticks only {@link BrowserWindow.moveTop moveTop} is called
 * to minimise overhead.
 */
const repositionWidget = () => {
  if (!miniPlayerWin || miniPlayerWin.isDestroyed()) return;

  repositionTickCount++;

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

  if (isShowing && !intentionalClose) {
    // Periodically force a full z-order toggle so the widget can recover
    // even when no Electron events fire (e.g. after the Start menu closes
    // and focus stays on the taskbar).  The opacity guard in
    // recoverVisibility() prevents visible stutter.
    if (repositionTickCount % FORCE_ZORDER_EVERY_N_TICKS === 0) {
      recoverVisibility();
    } else if (miniPlayerWin.isVisible()) {
      miniPlayerWin.moveTop();
    }
  }

  // Keep the visualizer in sync with the widget position
  repositionVisualizer();
};

export const createMiniPlayer = async (
  mainWindow: BrowserWindow,
  config: TaskbarWidgetPluginConfig,
) => {
  const { playPause, next, previous } = getSongControls(mainWindow);
  mainWindowRef = mainWindow;

  // Reset state from any previous session
  intentionalClose = false;
  isShowing = false;
  currentWidgetWidth = MIN_WIDGET_WIDTH;
  lastBounds = null;
  lastColorUrl = null;
  repositionTickCount = 0;
  clearBlurRecoveryTimers();

  selectedMonitorIndex = config.monitorIndex;
  positionOffsetX = config.offsetX;
  positionOffsetY = config.offsetY;
  backgroundBlurEnabled = config.backgroundBlur;
  visualizerEnabled = config.visualizer.enabled;
  visualizerPosition = config.visualizer.position;
  visualizerBarCount = config.visualizer.barCount;
  visualizerCenteredBars = config.visualizer.centeredBars;
  visualizerShowBaseline = config.visualizer.showBaseline;
  visualizerAudioSensitivity = config.visualizer.audioSensitivity;
  visualizerAudioPeakThreshold = config.visualizer.audioPeakThreshold;
  visualizerWidth = config.visualizer.width ?? 84;
  blurOpacity = config.blurOpacity ?? 0.5;
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

  // Apply initial blur opacity
  miniPlayerWin.webContents.send(
    'taskbar-widget:set-blur-opacity',
    blurOpacity,
  );

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

  // Forward audio frequency data from the renderer to the visualizer window
  audioDataHandler = (_, data: number[]) => {
    if (visualizerWin && !visualizerWin.isDestroyed()) {
      visualizerWin.webContents.send('taskbar-widget:audio-data', data);
    }
  };
  ipcMain.on('taskbar-widget:audio-data', audioDataHandler);

  // Send song info to the mini player
  const sendSongInfo = (songInfo: SongInfo) => {
    if (!miniPlayerWin || miniPlayerWin.isDestroyed()) return;

    // Strip the artist prefix from the title if present.
    // YouTube Music often formats titles as "Artist - Song Name" but
    // we already show the artist separately below the title.
    let displayTitle = songInfo.title;
    if (songInfo.artist && displayTitle) {
      const prefix = songInfo.artist + ' - ';
      if (displayTitle.startsWith(prefix)) {
        displayTitle = displayTitle.slice(prefix.length);
      }

      // Also handle reversed "Song - Artist" format
      const suffix = ' - ' + songInfo.artist;
      if (displayTitle.endsWith(suffix)) {
        displayTitle = displayTitle.slice(0, -suffix.length);
      }
    }

    // Extract year from uploadDate (format "YYYY-MM-DD") if available
    let uploadYear = '';
    if (songInfo.uploadDate && songInfo.uploadDate.length >= 4) {
      uploadYear = songInfo.uploadDate.slice(0, 4);
    }

    miniPlayerWin.webContents.send('taskbar-widget:song-info', {
      title: displayTitle,
      artist: songInfo.artist,
      imageSrc: songInfo.imageSrc,
      isPaused: songInfo.isPaused,
      year: uploadYear,
    });

    // Extract dominant color from album art for the dynamic blur background.
    // Only re-extract when the image URL changes.
    if (songInfo.imageSrc && songInfo.imageSrc !== lastColorUrl) {
      lastColorUrl = songInfo.imageSrc;
      extractDominantColor(songInfo.imageSrc).then((color) => {
        if (color && miniPlayerWin && !miniPlayerWin.isDestroyed()) {
          miniPlayerWin.webContents.send(
            'taskbar-widget:set-background-color',
            color,
          );
          // Also forward the color to the visualizer for bar tinting
          if (visualizerWin && !visualizerWin.isDestroyed()) {
            visualizerWin.webContents.send(
              'taskbar-widget:set-background-color',
              color,
            );
          }
        }
      });
    }

    // Show the mini player once we have a song
    if (songInfo.title && !miniPlayerWin.isVisible()) {
      isShowing = true;
      miniPlayerWin.setIgnoreMouseEvents(false);
      miniPlayerWin.showInactive();
      // Also create/show visualizer if enabled
      ensureVisualizerWindow(preloadPath);
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
export const updateConfig = (newConfig: TaskbarWidgetPluginConfig) => {
  positionOffsetX = newConfig.offsetX;
  positionOffsetY = newConfig.offsetY;
  backgroundBlurEnabled = newConfig.backgroundBlur;
  blurOpacity = newConfig.blurOpacity ?? 0.5;
  visualizerEnabled = newConfig.visualizer.enabled;
  visualizerPosition = newConfig.visualizer.position;
  visualizerWidth = newConfig.visualizer.width ?? 84;
  visualizerBarCount = newConfig.visualizer.barCount;
  visualizerCenteredBars = newConfig.visualizer.centeredBars;
  visualizerShowBaseline = newConfig.visualizer.showBaseline;
  visualizerAudioSensitivity = newConfig.visualizer.audioSensitivity;
  visualizerAudioPeakThreshold = newConfig.visualizer.audioPeakThreshold;
  lastBounds = null; // Force reposition on next tick

  if (miniPlayerWin && !miniPlayerWin.isDestroyed()) {
    repositionWidget();
    miniPlayerWin.webContents.send(
      'taskbar-widget:set-blur',
      newConfig.backgroundBlur,
    );
    miniPlayerWin.webContents.send(
      'taskbar-widget:set-blur-opacity',
      blurOpacity,
    );
  }

  // Create, update, or destroy visualizer as needed
  const preloadPath = path.join(getWidgetDir(), 'preload.js');
  ensureVisualizerWindow(preloadPath);
  sendVisualizerConfig();
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

  if (audioDataHandler) {
    ipcMain.removeListener('taskbar-widget:audio-data', audioDataHandler);
    audioDataHandler = null;
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

  if (visualizerWin && !visualizerWin.isDestroyed()) {
    visualizerWin.close();
  }
  visualizerWin = null;

  if (miniPlayerWin && !miniPlayerWin.isDestroyed()) {
    miniPlayerWin.close();
  }

  miniPlayerWin = null;
};
