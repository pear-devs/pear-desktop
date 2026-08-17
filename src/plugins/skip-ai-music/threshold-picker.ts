import { unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { app, BrowserWindow, ipcMain } from 'electron';

import promptOptions from '@/providers/prompt-options';

export type ThresholdPickerOptions = {
  cancelLabel: string;
  description: string;
  saveLabel: string;
  title: string;
  value: number;
  valueLabel: string;
};

const pickerHtml = (payload: Record<string, unknown>) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title></title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0f0f0f;
      --panel: #181818;
      --border: rgba(255, 255, 255, 0.1);
      --text: #f1f1f1;
      --muted: #aaa;
      --accent: #3ea6ff;
    }
    * {
      box-sizing: border-box;
    }
    html, body {
      margin: 0;
      height: 100%;
      background: var(--bg);
      color: var(--text);
      font: 14px/1.5 "Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, sans-serif;
    }
    body {
      display: flex;
      flex-direction: column;
      padding: 14px;
    }
    #container {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
    }
    #content {
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding: 20px 20px 16px;
    }
    #header {
      text-align: center;
    }
    h1 {
      margin: 0 0 6px;
      font-size: 18px;
      font-weight: 650;
    }
    #description {
      margin: 0;
      color: var(--muted);
      font-size: 13px;
      max-width: 34ch;
      margin-inline: auto;
    }
    #value-display {
      font-size: 32px;
      font-weight: 700;
      line-height: 1;
      color: var(--text);
      text-align: center;
    }
    #slider-block {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 0 2px;
    }
    .slider-shell {
      position: relative;
      height: 28px;
      display: flex;
      align-items: center;
    }
    #slider-track {
      position: absolute;
      left: 0;
      right: 0;
      height: 6px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.1);
      overflow: hidden;
      pointer-events: none;
    }
    #slider-fill {
      height: 100%;
      width: 0;
      border-radius: inherit;
      background: var(--accent);
    }
    #score-slider {
      -webkit-appearance: none;
      appearance: none;
      width: 100%;
      height: 28px;
      margin: 0;
      background: transparent;
      cursor: pointer;
    }
    #score-slider:focus {
      outline: none;
    }
    #score-slider::-webkit-slider-runnable-track {
      height: 6px;
      background: transparent;
    }
    #score-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 18px;
      height: 18px;
      margin-top: -6px;
      border: 2px solid #fff;
      border-radius: 50%;
      background: var(--accent);
    }
    #score-slider::-moz-range-track {
      height: 6px;
      background: transparent;
      border: 0;
    }
    #score-slider::-moz-range-thumb {
      width: 18px;
      height: 18px;
      border: 2px solid #fff;
      border-radius: 50%;
      background: var(--accent);
    }
    #slider-labels {
      display: flex;
      justify-content: space-between;
      color: var(--muted);
      font-size: 11px;
      font-variant-numeric: tabular-nums;
    }
    #actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      padding: 14px 18px;
      border-top: 1px solid var(--border);
      background: rgba(0, 0, 0, 0.2);
    }
    button {
      font: inherit;
      min-width: 96px;
      padding: 9px 16px;
      border-radius: 999px;
      cursor: pointer;
    }
    #cancel {
      color: var(--text);
      background: transparent;
      border: 1px solid var(--border);
    }
    #cancel:hover, #cancel:focus-visible {
      background: rgba(255, 255, 255, 0.06);
      outline: none;
    }
    #save {
      color: #fff;
      background: #ff0033;
      border: 1px solid #ff0033;
      font-weight: 600;
    }
    #save:hover, #save:focus-visible {
      background: #ff3355;
      border-color: #ff3355;
      outline: none;
    }
  </style>
</head>
<body>
  <div id="container">
    <div id="content">
      <div id="header">
        <h1 id="title"></h1>
        <p id="description"></p>
      </div>
      <div id="value-display"></div>
      <div id="slider-block">
        <div class="slider-shell">
          <div id="slider-track" aria-hidden="true">
            <div id="slider-fill"></div>
          </div>
          <input id="score-slider" type="range" min="0" max="100" step="1" aria-valuemin="0" aria-valuemax="100" />
        </div>
        <div id="slider-labels">
          <span>0%</span>
          <span>50%</span>
          <span>100%</span>
        </div>
      </div>
    </div>
    <div id="actions">
      <button id="cancel" type="button"></button>
      <button id="save" type="button"></button>
    </div>
  </div>
  <script>
    const payload = ${JSON.stringify(payload)};
    const { ipcRenderer } = require('electron');
    const slider = document.getElementById('score-slider');
    const valueDisplay = document.getElementById('value-display');
    const sliderFill = document.getElementById('slider-fill');

    document.title = payload.title;
    document.getElementById('title').textContent = payload.title;
    document.getElementById('description').textContent = payload.description;
    document.getElementById('cancel').textContent = payload.cancelLabel;
    document.getElementById('save').textContent = payload.saveLabel;

    const formatValue = (score) =>
      payload.valueLabel.replace('{score}', String(score));

    const setValue = (score) => {
      slider.value = String(score);
      valueDisplay.textContent = formatValue(score);
      slider.setAttribute('aria-valuenow', String(score));
      sliderFill.style.width = score + '%';
    };

    const close = (value) => {
      ipcRenderer.send(payload.channel, value);
    };

    setValue(payload.value);
    slider.addEventListener('input', () => {
      setValue(Number(slider.value));
    });

    document.getElementById('cancel').addEventListener('click', () => close(null));
    document.getElementById('save').addEventListener('click', () => {
      close(Number(slider.value));
    });
    window.addEventListener('keydown', (event) => {
      if (event.key == 'Escape') {
        close(null);
      }
      if (event.key == 'Enter') {
        close(Number(slider.value));
      }
    });
    document.getElementById('save').focus();
  </script>
</body>
</html>
`;

export const promptThreshold = (
  parent: Electron.BrowserWindow,
  options: ThresholdPickerOptions,
): Promise<number | null> =>
  new Promise((resolve) => {
    const channel = `skip-ai-music-threshold:${Date.now()}-${Math.random()}`;
    const { icon } = promptOptions();
    let settled = false;
    const file = path.join(
      app.getPath('temp'),
      `skip-ai-music-threshold-${Date.now()}.html`,
    );
    const editor = new BrowserWindow({
      parent,
      modal: true,
      width: 440,
      height: 340,
      minWidth: 380,
      minHeight: 320,
      show: false,
      resizable: false,
      autoHideMenuBar: true,
      title: options.title,
      icon: icon || undefined,
      backgroundColor: '#0f0f0f',
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
    });

    const finish = (value: number | null) => {
      if (settled) {
        return;
      }
      settled = true;
      ipcMain.removeAllListeners(channel);
      unlink(file).catch(() => {});
      if (!editor.isDestroyed()) {
        editor.destroy();
      }
      resolve(value);
    };

    ipcMain.once(channel, (_event, value: number | null) => {
      if (value == null || !Number.isFinite(Number(value))) {
        finish(null);
        return;
      }
      finish(Math.round(Number(value)));
    });

    editor.once('closed', () => {
      finish(null);
    });

    editor.once('ready-to-show', () => {
      editor.show();
    });

    editor.setMenu(null);
    writeFile(
      file,
      pickerHtml({
        ...options,
        channel,
      }),
      'utf8',
    )
      .then(() => editor.loadFile(file))
      .catch((error: unknown) => {
        console.error(error);
        finish(null);
      });
  });
