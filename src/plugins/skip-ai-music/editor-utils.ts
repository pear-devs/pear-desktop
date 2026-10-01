import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { app } from 'electron';

let preloadPath: string | null = null;

export const serializeEditorPayload = (payload: Record<string, unknown>) =>
  JSON.stringify(payload).replace(/</g, '\\u003c');

export const getEditorPreloadPath = async () => {
  if (preloadPath) {
    return preloadPath;
  }

  const file = path.join(
    app.getPath('temp'),
    'skip-ai-music-editor-preload.js',
  );
  await writeFile(
    file,
    `const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('skipAiMusicEditor', {
  send: (channel, value) => ipcRenderer.send(channel, value),
});
`,
    'utf8',
  );
  preloadPath = file;
  return file;
};

export const editorWebPreferences = async () => ({
  preload: await getEditorPreloadPath(),
  contextIsolation: true,
  nodeIntegration: false,
});
