import { type BrowserWindow, ipcMain } from 'electron';

import { deepmerge } from 'deepmerge-ts';
import { allPlugins, mainPlugins } from 'virtual:plugins';

import * as config from '@/config';
import { LoggerPrefix, startPlugin, stopPlugin } from '@/utils';

import { t } from '@/i18n';

import type { PluginConfig, PluginDef } from '@/types/plugins';
import type { BackendContext } from '@/types/contexts';

const loadedPluginMap: Record<
  string,
  PluginDef<unknown, unknown, unknown>
> = {};

const createContext = (
  id: string,
  win: BrowserWindow,
): BackendContext<PluginConfig> => ({
  getConfig: async () =>
    deepmerge(
      (await allPlugins())[id].config ?? { enabled: false },
      config.get(`plugins.${id}`) ?? {},
    ) as PluginConfig,
  setConfig: async (newConfig) => {
    config.setPartial(
      `plugins.${id}`,
      newConfig,
      (await allPlugins())[id].config,
    );
  },

  ipc: {
    send: (event: string, ...args: unknown[]) => {
      win.webContents.send(event, ...args);
    },
    handle: (event: string, listener: CallableFunction) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return,@typescript-eslint/no-unsafe-call
      ipcMain.handle(event, (_, ...args: unknown[]) => listener(...args));
    },
    on: (event: string, listener: CallableFunction) => {
      ipcMain.on(event, (_, ...args: unknown[]) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        listener(...args);
      });
    },
    removeHandler: (event: string) => {
      ipcMain.removeHandler(event);
    },
  },

  window: win,
});

export const forceUnloadMainPlugin = async (
  id: string,
  win: BrowserWindow,
): Promise<void> => {
  const plugin = loadedPluginMap[id];
  if (!plugin) return;

  try {
    const hasStopped = await stopPlugin(id, plugin, {
      ctx: 'backend',
      context: createContext(id, win),
    });
    if (
      hasStopped ||
      (hasStopped === null &&
        typeof plugin.backend !== 'function' &&
        plugin.backend)
    ) {
      delete loadedPluginMap[id];
      console.log(
        LoggerPrefix,
        t('common.console.plugins.unloaded', { pluginName: id }),
      );
      return;
    } else {
      const message = t('common.console.plugins.unload-failed', {
        pluginName: id,
      });
      console.log(LoggerPrefix, message);
      return Promise.reject(new Error(message));
    }
  } catch (err) {
    console.error(
      LoggerPrefix,
      t('common.console.plugins.unload-failed', { pluginName: id }),
    );
    console.trace(err);
    return Promise.reject(err as Error);
  }
};

export const forceLoadMainPlugin = async (
  id: string,
  win: BrowserWindow,
): Promise<void> => {
  const plugin = (await mainPlugins())[id];
  if (!plugin) return;

  try {
    const hasStarted = await startPlugin(id, plugin, {
      ctx: 'backend',
      context: createContext(id, win),
    });
    if (
      hasStarted ||
      (hasStarted === null &&
        typeof plugin.backend !== 'function' &&
        plugin.backend)
    ) {
      loadedPluginMap[id] = plugin;
    } else {
      const message = t('common.console.plugins.load-failed', {
        pluginName: id,
      });
      console.log(LoggerPrefix, message);
      return Promise.reject(new Error(message));
    }
  } catch (err) {
    console.error(
      LoggerPrefix,
      t('common.console.plugins.initialize-failed', { pluginName: id }),
    );
    console.trace(err);
    return Promise.reject(err as Error);
  }
};

const topologicalSort = (plugins: Record<string, PluginDef<unknown, unknown, unknown>>) => {
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const order: string[] = [];

  const visit = (id: string) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      console.warn(`Circular dependency detected involving plugin: ${id}`);
      return;
    }

    visiting.add(id);
    const plugin = plugins[id];
    if (plugin?.dependencies) {
      for (const dep of plugin.dependencies) {
        if (plugins[dep]) {
          visit(dep);
        } else {
          console.warn(`Plugin ${id} depends on ${dep} which is not found`);
        }
      }
    }
    visiting.delete(id);
    visited.add(id);
    order.push(id);
  };

  for (const id of Object.keys(plugins)) {
    visit(id);
  }

  return order;
};

export const loadAllMainPlugins = async (win: BrowserWindow) => {
  console.log(LoggerPrefix, t('common.console.plugins.load-all'));
  const pluginConfigs = config.plugins.getPlugins();
  const allPluginsMap = await mainPlugins();
  const sortedPluginIds = topologicalSort(allPluginsMap);
  const queue: Promise<void>[] = [];

  for (const plugin of sortedPluginIds) {
    const pluginDef = allPluginsMap[plugin];
    const pluginConfig = deepmerge(pluginDef.config, pluginConfigs[plugin] ?? {});
    if (pluginConfig.enabled) {
      queue.push(forceLoadMainPlugin(plugin, win));
    } else if (loadedPluginMap[plugin]) {
      queue.push(forceUnloadMainPlugin(plugin, win));
    }
  }

  await Promise.allSettled(queue);
};

export const unloadAllMainPlugins = async (win: BrowserWindow) => {
  for (const id of Object.keys(loadedPluginMap)) {
    await forceUnloadMainPlugin(id, win);
  }
};

export const getLoadedMainPlugin = (
  id: string,
): PluginDef<unknown, unknown, unknown> | undefined => {
  return loadedPluginMap[id];
};

export const getAllLoadedMainPlugins = () => {
  return loadedPluginMap;
};
