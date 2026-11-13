import { type BrowserWindow, ipcMain, type IpcMainEvent } from 'electron';
import { mainPlugins } from 'virtual:plugins';

import * as config from '@/config';
import { t } from '@/i18n';
import { registerCallback } from '@/providers/song-info';
import { LoggerPrefix } from '@/utils';

import { createBaseContext } from './context';
import {
  IpcRegistry,
  PLUGIN_EVENT,
  PLUGIN_INVOKE,
  PLUGIN_SEND,
} from './ipc-registry';
import { type Instance, PluginRunner } from './runner';

import type { ConfigShape } from '@/plugins/utils/common/config';
import type { BackendContext, BackendIpc } from '@/types/contexts';

// oxlint-disable-next-line typescript/no-explicit-any
type AnyBackendContext = BackendContext<any, any>;

const registry = new IpcRegistry();
let currentWindow: BrowserWindow | null = null;

const createContext = (instance: Instance): AnyBackendContext => {
  const { id, cleanups } = instance;
  const window = currentWindow!;
  const send = (channel: string, ...args: unknown[]) => {
    if (!window.isDestroyed()) window.webContents.send(channel, ...args);
  };

  const ipc: BackendIpc<Record<string, never>> = {
    handle: (name: string, handler: (...args: never[]) => unknown) => {
      cleanups.add(registry.handle(id, name, handler));
    },
    send: (name: string, ...args: unknown[]) =>
      send(PLUGIN_EVENT, id, name, args),
    on: (name: string, listener: (...args: never[]) => void) => {
      cleanups.add(registry.on(id, name, listener));
    },
    core: {
      on(channel, listener) {
        const wrapper = (_: IpcMainEvent, ...args: unknown[]) =>
          listener(...args);
        ipcMain.on(channel, wrapper);
        cleanups.add(() => ipcMain.removeListener(channel, wrapper));
      },
      once(channel, listener) {
        let unregister = () => {};
        const wrapper = (_: IpcMainEvent, ...args: unknown[]) => {
          unregister();
          listener(...args);
        };
        ipcMain.once(channel, wrapper);
        unregister = cleanups.add(() =>
          ipcMain.removeListener(channel, wrapper),
        );
      },
      handle(channel, handler) {
        ipcMain.handle(channel, (_, ...args: unknown[]) => handler(...args));
        cleanups.add(() => ipcMain.removeHandler(channel));
      },
      send,
    },
  } as BackendIpc<Record<string, never>>;

  const base = createBaseContext(instance, (patch) =>
    config.plugins.setPluginConfig(id, patch),
  );
  return Object.assign(base, {
    window,
    ipc,
    onSongInfo: (callback: Parameters<typeof registerCallback>[0]) => {
      cleanups.add(registerCallback(callback));
    },
  }) as AnyBackendContext;
};

const runner = new PluginRunner<AnyBackendContext>({
  async load(id) {
    const plugin = (await mainPlugins())[id];
    return (
      plugin && {
        part: plugin.backend,
        schema: plugin.config as ConfigShape | undefined,
      }
    );
  },
  createContext,
  onStarted(id, ms) {
    console.log(
      LoggerPrefix,
      t('common.console.plugins.executed-at-ms', {
        pluginName: id,
        contextName: 'backend',
        ms: ms.toFixed(2),
      }),
    );
  },
  onStopped(id) {
    console.log(
      LoggerPrefix,
      t('common.console.plugins.unloaded', { pluginName: id }),
    );
  },
  onError(id, phase, error) {
    const key =
      phase === 'start'
        ? 'common.console.plugins.initialize-failed'
        : 'common.console.plugins.execute-failed';
    console.error(
      LoggerPrefix,
      t(key, { pluginName: id, contextName: 'backend' }),
      error,
    );
  },
});

let ipcReady = false;
/** The fixed IPC channels plugins and their config go through. Call once. */
export const setupPluginIpc = () => {
  if (ipcReady) return;
  ipcReady = true;
  ipcMain.handle(
    PLUGIN_INVOKE,
    (_, id: string, name: string, args: unknown[]) =>
      registry.invoke(
        String(id),
        String(name),
        Array.isArray(args) ? args : [],
      ),
  );
  ipcMain.on(PLUGIN_SEND, (_, id: string, name: string, args: unknown[]) =>
    registry.emit(String(id), String(name), Array.isArray(args) ? args : []),
  );
  ipcMain.handle('peard:set-config', (_, id: string, patch: unknown) =>
    config.plugins.setPluginConfig(String(id), patch),
  );
};

/** Starts every enabled plugin's backend for `win` (restarting them for a new window). */
export const loadAllMainPlugins = async (win: BrowserWindow) => {
  console.log(LoggerPrefix, t('common.console.plugins.load-all'));
  if (currentWindow && currentWindow !== win) await runner.stopAll();
  currentWindow = win;

  await Promise.allSettled(
    Object.keys(await mainPlugins()).map(async (id) => {
      const state = await config.plugins.getPluginState(id);
      if (state.enabled) await runner.start(id, state.config);
    }),
  );
};

export const startMainPlugin = async (id: string) => {
  if (!currentWindow) return;
  const state = await config.plugins.getPluginState(id);
  await runner.start(id, state.config);
};

export const stopMainPlugin = (id: string) => runner.stop(id);

export const applyMainPluginConfig = (
  id: string,
  pluginConfig: Record<string, unknown>,
) => runner.applyConfig(id, pluginConfig);

export const unloadAllMainPlugins = () => runner.stopAll();
