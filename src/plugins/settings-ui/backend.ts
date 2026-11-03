import os from 'node:os';

import {
  app,
  BrowserWindow,
  dialog,
  shell,
  type OpenDialogOptions,
} from 'electron';
import electronUpdater from 'electron-updater';

import * as config from '@/config';
import { restart } from '@/providers/app-controls';
import { createBackend } from '@/utils';

import type { SettingsUIConfig } from './index';

export const backend = createBackend<
  { unwatch: (() => void) | undefined },
  SettingsUIConfig
>({
  unwatch: undefined as (() => void) | undefined,

  start(ctx) {
    const { ipc, window } = ctx;

    ipc.handle('ytmd-sui:load-store', () => config.getStore());

    ipc.handle('ytmd-sui:option-set', (key: string, value: unknown) => {
      if (typeof key !== 'string' || !key) return;
      config.set(key, value);
    });

    ipc.handle('ytmd-sui:plugin-toggle', (id: string, enabled: boolean) => {
      if (typeof id !== 'string' || !id || typeof enabled !== 'boolean') return;
      if (enabled) config.plugins.enable(id);
      else config.plugins.disable(id);
    });

    ipc.handle(
      'ytmd-sui:pick-path',
      async (options: OpenDialogOptions): Promise<string | undefined> => {
        const result = await dialog.showOpenDialog(window, options);
        return result.canceled ? undefined : result.filePaths[0];
      },
    );

    ipc.handle('ytmd-sui:config-edit', () => config.edit());
    ipc.handle('ytmd-sui:toggle-devtools', () =>
      window.webContents.toggleDevTools(),
    );
    ipc.handle('ytmd-sui:restart', () => restart());
    ipc.handle('ytmd-sui:app-meta', () => ({
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      osVersion: `${os.type()} ${os.release()}`,
      versions: {
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
      },
    }));

    ipc.handle('ytmd-sui:open-external', async (url: string) => {
      try {
        const { protocol } = new URL(url);
        if (protocol === 'https:' || protocol === 'http:') {
          await shell.openExternal(url);
        }
      } catch {}
    });

    ipc.handle('ytmd-sui:check-updates', () =>
      electronUpdater.autoUpdater.checkForUpdatesAndNotify(),
    );

    this.unwatch = config.watch(() => {
      const store = config.getStore();
      // Broadcast to every window: the injected modal lives in the main
      // window, but the standalone tray settings window is a separate
      // BrowserWindow that must also stay in sync.
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send('ytmd-sui:store-changed', store);
        }
      }
    });
  },

  stop(ctx) {
    this.unwatch?.();
    this.unwatch = undefined;

    for (const channel of [
      'ytmd-sui:load-store',
      'ytmd-sui:option-set',
      'ytmd-sui:plugin-toggle',
      'ytmd-sui:pick-path',
      'ytmd-sui:config-edit',
      'ytmd-sui:toggle-devtools',
      'ytmd-sui:restart',
      'ytmd-sui:app-meta',
      'ytmd-sui:open-external',
      'ytmd-sui:check-updates',
    ]) {
      ctx.ipc.removeHandler(channel);
    }
  },
});
