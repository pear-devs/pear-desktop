import { rendererPlugins } from 'virtual:plugins';

import { t } from '@/i18n';
import {
  type ConfigShape,
  resolvePluginState,
} from '@/plugins/utils/common/config';
import { LoggerPrefix } from '@/utils';

import { createBaseContext } from './context';
import {
  IpcRegistry,
  PLUGIN_EVENT,
  PLUGIN_INVOKE,
  PLUGIN_SEND,
} from './ipc-registry';
import { type Instance, PluginRunner } from './runner';

import type {
  RendererContext,
  RendererIpc,
  StyleHandle,
} from '@/types/contexts';
import type { MusicPlayer } from '@/types/music-player';

// oxlint-disable-next-line typescript/no-explicit-any
type AnyRendererContext = RendererContext<any, any>;

const registry = new IpcRegistry();

let playerApi: MusicPlayer | null = null;
const playerApiWaiters = new Set<(api: MusicPlayer) => unknown>();

const createContext = (instance: Instance): AnyRendererContext => {
  const { id, cleanups } = instance;

  const ipc = {
    invoke: (name: string, ...args: unknown[]) =>
      window.ipcRenderer.invoke(PLUGIN_INVOKE, id, name, args),
    send: (name: string, ...args: unknown[]) =>
      window.ipcRenderer.send(PLUGIN_SEND, id, name, args),
    on: (name: string, listener: (...args: never[]) => void) => {
      cleanups.add(registry.on(id, name, listener));
    },
    core: {
      on(channel, listener) {
        cleanups.add(
          window.ipcRenderer.on(channel, (_, ...args: unknown[]) =>
            listener(...args),
          ),
        );
      },
      once(channel, listener) {
        let unregister = () => {};
        const off = window.ipcRenderer.on(channel, (_, ...args: unknown[]) => {
          off();
          unregister();
          listener(...args);
        });
        unregister = cleanups.add(off);
      },
      send: (channel, ...args) => window.ipcRenderer.send(channel, ...args),
      invoke: <T>(channel: string, ...args: unknown[]) =>
        window.ipcRenderer.invoke(channel, ...args) as Promise<T>,
    },
  } as RendererIpc<Record<string, never>>;

  const addStyle = (css: string): StyleHandle => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    const remove = () => {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
        (it) => it !== sheet,
      );
    };
    cleanups.add(remove);
    return { update: (next) => sheet.replaceSync(next), remove };
  };

  const base = createBaseContext(instance, (patch) =>
    window.ipcRenderer.invoke('peard:set-config', id, patch),
  );
  return Object.assign(base, {
    ipc,
    observe(
      target: Node,
      options: MutationObserverInit,
      callback: MutationCallback,
    ) {
      const observer = new MutationObserver(callback);
      observer.observe(target, options);
      cleanups.add(() => observer.disconnect());
      return observer;
    },
    addStyle,
    onPlayerApiReady(callback: (api: MusicPlayer) => unknown) {
      if (playerApi) {
        Promise.resolve()
          .then(() => !instance.stopped && callback(playerApi!))
          .catch((error) => base.log.error(error));
        return;
      }
      const waiter = (api: MusicPlayer) =>
        instance.stopped ? undefined : callback(api);
      playerApiWaiters.add(waiter);
      cleanups.add(() => playerApiWaiters.delete(waiter));
    },
  }) as AnyRendererContext;
};

const runner = new PluginRunner<AnyRendererContext>({
  async load(id) {
    const plugin = (await rendererPlugins())[id];
    if (!plugin) return undefined;
    const { renderer, stylesheets } = plugin;
    return {
      schema: plugin.config as ConfigShape | undefined,
      part: (ctx) => {
        for (const css of stylesheets ?? []) ctx.addStyle(css);
        return renderer?.(ctx);
      },
    };
  },
  createContext,
  onStarted(id) {
    console.log(
      LoggerPrefix,
      t('common.console.plugins.loaded', { pluginName: id }),
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
      t(key, { pluginName: id, contextName: 'renderer' }),
      error,
    );
  },
});

const stateOf = async (id: string) =>
  resolvePluginState(
    (await rendererPlugins())[id],
    window.mainConfig.plugins.getPlugins()[id],
  );

/** Routes the backend's `ctx.ipc.send` to renderer plugins. Call once. */
export const setupRendererPluginIpc = () => {
  window.ipcRenderer.on(
    PLUGIN_EVENT,
    (_, id: string, name: string, args: unknown[]) =>
      registry.emit(id, name, Array.isArray(args) ? args : []),
  );
};

export const loadAllRendererPlugins = async () => {
  for (const id of Object.keys(await rendererPlugins())) {
    const state = await stateOf(id);
    if (state.enabled) await runner.start(id, state.config);
  }
};

export const startRendererPlugin = async (id: string) => {
  const state = await stateOf(id);
  await runner.start(id, state.config);
};

export const stopRendererPlugin = (id: string) => runner.stop(id);

export const applyRendererPluginConfig = (
  id: string,
  pluginConfig: Record<string, unknown>,
) => runner.applyConfig(id, pluginConfig);

/** Hands the player API to the plugins waiting for it, in order. */
export const notifyPlayerApiReady = async (api: MusicPlayer) => {
  playerApi = api;
  const waiters = [...playerApiWaiters];
  playerApiWaiters.clear();
  for (const waiter of waiters) {
    try {
      await waiter(api);
    } catch (error) {
      console.error(LoggerPrefix, error);
    }
  }
};
