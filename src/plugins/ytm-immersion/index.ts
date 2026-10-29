import { join } from 'node:path';

import { app, BrowserWindow, globalShortcut } from 'electron';

import { createPlugin } from '@/utils';

let extensionId: string | null = null;
let settingsWindow: BrowserWindow | null = null;
let targetWindow: BrowserWindow | null = null;

const getExtensionPath = () =>
  app.isPackaged
    ? join(
        process.resourcesPath,
        'app.asar.unpacked',
        'assets',
        'ytm-immersion',
      )
    : join(app.getAppPath(), 'assets', 'ytm-immersion');

const toggleImmersion = async () => {
  if (!targetWindow || targetWindow.isDestroyed()) return;
  try {
    await targetWindow.webContents.executeJavaScript(
      "document.querySelector('#my-mode-toggle')?.click()",
      true,
    );
  } catch (error) {
    console.warn('[YTM-Immersion] Could not toggle Immersion mode', error);
  }
};

const openSettings = async (parent: BrowserWindow) => {
  if (!extensionId) return;
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  const child = new BrowserWindow({
    parent,
    width: 800,
    height: 720,
    title: 'YTM-Immersion Settings',
    webPreferences: { session: parent.webContents.session },
  });
  settingsWindow = child;
  child.on('closed', () => {
    settingsWindow = null;
  });
  await child.loadURL(`chrome-extension://${extensionId}/src/options.html`);
};

export default createPlugin({
  name: () => 'YTM-Immersion',
  description: () => 'Apple Music-style lyrics and glass UI for YouTube Music.',
  authors: ['Naikaku (YTM-Immersion)'],
  addedVersion: '3.13.X',
  restartNeeded: true,
  config: { enabled: false },
  menu: ({ window }) => [
    {
      label: 'YTM-Immersion settings',
      click: async () => {
        await openSettings(window);
      },
    },
  ],
  backend: {
    async start({ window }) {
      targetWindow = window;
      const extension =
        await window.webContents.session.extensions.loadExtension(
          getExtensionPath(),
        );
      extensionId = extension.id;
      globalShortcut.register('Alt+Shift+I', toggleImmersion);
    },
    stop({ window }) {
      globalShortcut.unregister('Alt+Shift+I');
      settingsWindow?.close();
      settingsWindow = null;
      targetWindow = null;
      if (extensionId) {
        window.webContents.session.extensions.removeExtension(extensionId);
        extensionId = null;
      }
    },
  },
});
