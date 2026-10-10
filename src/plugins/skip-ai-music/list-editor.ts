import { unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { app, BrowserWindow, ipcMain } from 'electron';

import promptOptions from '@/providers/prompt-options';

import {
  editorWebPreferences,
  serializeEditorPayload,
} from './editor-utils';

export type ListEditorOptions = {
  addLabel: string;
  cancelLabel: string;
  description: string;
  duplicateLabel: string;
  emptyLabel: string;
  placeholder: string;
  removeLabel: string;
  removeNamedLabel: string;
  saveLabel: string;
  title: string;
  values: string[];
};

const editorHtml = (payload: Record<string, unknown>) => {
  const serializedPayload = serializeEditorPayload(payload);
  return `<!DOCTYPE html>
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
      gap: 14px;
      padding: 20px 20px 16px;
      flex: 1;
      min-height: 0;
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
      max-width: 36ch;
      margin-inline: auto;
    }
    #count {
      font-size: 12px;
      color: var(--muted);
      text-align: right;
    }
    #list-wrap {
      flex: 1;
      min-height: 160px;
      overflow: auto;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: rgba(0, 0, 0, 0.25);
    }
    #list {
      margin: 0;
    }
    #empty {
      margin: 0;
      padding: 28px 16px;
      color: var(--muted);
      text-align: center;
      font-size: 13px;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 9px 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }
    .row:last-child {
      border-bottom: 0;
    }
    .name {
      flex: 1;
      overflow-wrap: anywhere;
      font-size: 13px;
    }
    #add-form {
      display: flex;
      gap: 8px;
    }
    #add-form label {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
    input, button {
      font: inherit;
    }
    #item-input {
      flex: 1;
      min-width: 0;
      color: var(--text);
      background: rgba(0, 0, 0, 0.35);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 9px 11px;
    }
    #item-input:focus {
      outline: none;
      border-color: rgba(255, 255, 255, 0.22);
    }
    button {
      cursor: pointer;
      border-radius: 999px;
      padding: 9px 14px;
    }
    .row-remove {
      color: var(--muted);
      background: transparent;
      border: 1px solid transparent;
      padding: 4px 10px;
      font-size: 12px;
    }
    .row-remove:hover, .row-remove:focus-visible {
      color: var(--text);
      border-color: var(--border);
      outline: none;
    }
    #add {
      color: var(--text);
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid var(--border);
      white-space: nowrap;
    }
    #add:hover, #add:focus-visible {
      background: rgba(255, 255, 255, 0.1);
      outline: none;
    }
    #actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      padding: 14px 18px;
      border-top: 1px solid var(--border);
      background: rgba(0, 0, 0, 0.2);
    }
    #cancel {
      color: var(--text);
      background: transparent;
      border: 1px solid var(--border);
      min-width: 96px;
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
      min-width: 96px;
    }
    #save:hover, #save:focus-visible {
      background: #ff3355;
      border-color: #ff3355;
      outline: none;
    }
    #status {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
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
      <div id="count"></div>
      <div id="list-wrap">
        <div id="list" role="list"></div>
        <p id="empty" hidden></p>
      </div>
      <form id="add-form">
        <label for="item-input"></label>
        <input id="item-input" type="text" autocomplete="off" />
        <button id="add" type="submit"></button>
      </form>
      <div id="status" aria-live="polite"></div>
    </div>
    <div id="actions">
      <button id="cancel" type="button"></button>
      <button id="save" type="button"></button>
    </div>
  </div>
  <script>
    const payload = ${serializedPayload};
    const items = [...payload.values];
    const list = document.getElementById('list');
    const empty = document.getElementById('empty');
    const count = document.getElementById('count');
    const input = document.getElementById('item-input');
    const status = document.getElementById('status');

    document.title = payload.title;
    document.getElementById('title').textContent = payload.title;
    document.getElementById('description').textContent = payload.description;
    empty.textContent = payload.emptyLabel;
    document.querySelector('#add-form label').textContent = payload.placeholder;
    input.placeholder = payload.placeholder;
    document.getElementById('add').textContent = payload.addLabel;
    document.getElementById('cancel').textContent = payload.cancelLabel;
    document.getElementById('save').textContent = payload.saveLabel;

    const close = (value) => {
      window.skipAiMusicEditor.send(payload.channel, value);
    };

    const sameName = (left, right) =>
      left.trim().toLowerCase() == right.trim().toLowerCase();

    const sortItems = () => {
      items.sort((left, right) =>
        left.localeCompare(right, undefined, { sensitivity: 'base' }),
      );
    };

    const render = () => {
      sortItems();
      list.replaceChildren();
      empty.hidden = items.length > 0;
      count.textContent = items.length > 0 ? items.length + ' entries' : '';

      for (const name of items) {
        const row = document.createElement('div');
        row.className = 'row';
        row.setAttribute('role', 'listitem');

        const label = document.createElement('span');
        label.className = 'name';
        label.textContent = name;

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'row-remove';
        remove.textContent = payload.removeLabel;
        remove.setAttribute(
          'aria-label',
          payload.removeNamedLabel.replace('{name}', name),
        );
        remove.addEventListener('click', () => {
          const index = items.findIndex((item) => sameName(item, name));
          if (index >= 0) {
            items.splice(index, 1);
            status.textContent = payload.removeNamedLabel.replace('{name}', name);
            render();
            input.focus();
          }
        });

        row.append(label, remove);
        list.append(row);
      }
    };

    document.getElementById('add-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const value = input.value.trim();
      if (!value) {
        return;
      }
      if (items.some((item) => sameName(item, value))) {
        status.textContent = payload.duplicateLabel.replace('{name}', value);
        input.select();
        return;
      }
      items.push(value);
      input.value = '';
      status.textContent = value;
      render();
      input.focus();
    });

    document.getElementById('cancel').addEventListener('click', () => close(null));
    document.getElementById('save').addEventListener('click', () => {
      sortItems();
      close(items);
    });
    window.addEventListener('keydown', (event) => {
      if (event.key == 'Escape') {
        close(null);
      }
      if (event.key == 'Enter' && document.activeElement != input) {
        sortItems();
        close(items);
      }
    });

    render();
    input.focus();
  </script>
</body>
</html>
`;
};

export const promptStringList = (
  parent: Electron.BrowserWindow,
  options: ListEditorOptions,
): Promise<string[] | null> =>
  new Promise((resolve) => {
    const run = async () => {
      const channel = `skip-ai-music-list-editor:${Date.now()}-${Math.random()}`;
      const { icon } = promptOptions();
      let settled = false;
      let editor: BrowserWindow | undefined;
      const file = path.join(
        app.getPath('temp'),
        `skip-ai-music-list-${Date.now()}.html`,
      );

      const finish = (value: string[] | null) => {
        if (settled) {
          return;
        }
        settled = true;
        ipcMain.removeAllListeners(channel);
        unlink(file).catch(() => {});
        if (editor && !editor.isDestroyed()) {
          editor.destroy();
        }
        resolve(value);
      };

      try {
        const webPreferences = await editorWebPreferences();
        editor = new BrowserWindow({
          parent,
          modal: true,
          width: 480,
          height: 540,
          minWidth: 400,
          minHeight: 420,
          show: false,
          autoHideMenuBar: true,
          title: options.title,
          icon: icon || undefined,
          backgroundColor: '#0f0f0f',
          webPreferences,
        });

        ipcMain.once(channel, (_event, value: string[] | null) => {
          finish(Array.isArray(value) ? value : null);
        });

        editor.once('closed', () => {
          finish(null);
        });

        editor.once('ready-to-show', () => {
          if (editor && !editor.isDestroyed()) {
            editor.show();
          }
        });

        editor.setMenu(null);
        await writeFile(
          file,
          editorHtml({
            ...options,
            channel,
          }),
          'utf8',
        );
        await editor.loadFile(file);
      } catch (error: unknown) {
        console.error(error);
        finish(null);
      }
    };

    run().catch((error: unknown) => {
      console.error(error);
      resolve(null);
    });
  });
