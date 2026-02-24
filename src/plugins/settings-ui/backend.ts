import is from 'electron-is';
import { app } from 'electron';

import * as config from '@/config';
import * as Plugins from '@/config/plugins';

import { createBackend } from '@/utils';

const getVersion = () => app.getVersion();

const platform = () => {
  const { arch } = process;

  if (is.windows()) return `Windows (${arch})`;
  if (is.macOS()) return `macOS (${arch})`;
  if (is.linux()) {
    const desktop =
      process.env.XDG_CURRENT_DESKTOP || process.env.XDG_SESSION_DESKTOP;
    const type = process.env.XDG_SESSION_TYPE;

    return `Linux (desktop=${desktop}; type=${type}; arch=${arch})`;
  }
  return process.platform + ` (${arch})`;
};

const versions = () => process.versions;

const plugins = {
  enable: (id: string) => {
    Plugins.enable(id);
  },
  disable: (id: string) => {
    Plugins.disable(id);
  },
};

export type ConfigKey = Parameters<typeof config.get>[0];

const configHandlers = {
  get: <T extends ConfigKey>(key: T) => config.get(key),
  set: (key: ConfigKey, value: unknown) => config.set(key, value),
};

const loadSettings = () => config.getStore();

export const backend = createBackend({
  start(ctx) {
    ctx.ipc.handle('ytmd-sui:app-version', getVersion);
    ctx.ipc.handle('ytmd-sui:platform', platform);
    ctx.ipc.handle('ytmd-sui:versions', versions);
    ctx.ipc.handle('ytmd-sui:load-settings', loadSettings);

    ctx.ipc.handle('ytmd-sui:config-get', configHandlers.get);
    ctx.ipc.handle('ytmd-sui:config-set', configHandlers.set);

    ctx.ipc.handle('ytmd-sui:plugins-enable', plugins.enable);
    ctx.ipc.handle('ytmd-sui:plugins-disable', plugins.disable);
  },

  stop(ctx) {
    ctx.ipc.removeHandler('ytmd-sui:app-version');
    ctx.ipc.removeHandler('ytmd-sui:platform');
    ctx.ipc.removeHandler('ytmd-sui:versions');
    ctx.ipc.removeHandler('ytmd-sui:load-settings');

    ctx.ipc.removeHandler('ytmd-sui:config-get');
    ctx.ipc.removeHandler('ytmd-sui:config-set');

    ctx.ipc.removeHandler('ytmd-sui:plugins-enable');
    ctx.ipc.removeHandler('ytmd-sui:plugins-disable');
    ctx.ipc.removeHandler('ytmd-sui:plugins-isEnabled');
  },
});
