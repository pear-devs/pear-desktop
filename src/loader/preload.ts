import { ipcRenderer } from 'electron';
import { preloadPlugins } from 'virtual:plugins';

import * as config from '@/config';
import { t } from '@/i18n';
import { LoggerPrefix } from '@/utils';

import { createBaseContext } from './context';
import { PluginRunner } from './runner';

import type { ConfigShape } from '@/plugins/utils/common/config';
import type { PreloadContext } from '@/types/contexts';

// oxlint-disable-next-line typescript/no-explicit-any
type AnyPreloadContext = PreloadContext<any>;

const runner = new PluginRunner<AnyPreloadContext>({
  async load(id) {
    const plugin = (await preloadPlugins())[id];
    return (
      plugin && {
        part: plugin.preload,
        schema: plugin.config as ConfigShape | undefined,
      }
    );
  },
  createContext: (instance) =>
    createBaseContext(instance, (patch) =>
      ipcRenderer.invoke('peard:set-config', instance.id, patch),
    ),
  onStarted(id) {
    console.log(
      LoggerPrefix,
      t('common.console.plugins.loaded', { pluginName: id }),
    );
  },
  onError(id, _phase, error) {
    console.error(
      LoggerPrefix,
      t('common.console.plugins.initialize-failed', { pluginName: id }),
      error,
    );
  },
});

export const loadAllPreloadPlugins = async () => {
  await Promise.allSettled(
    Object.keys(await preloadPlugins()).map(async (id) => {
      const state = await config.plugins.getPluginState(id);
      if (state.enabled) await runner.start(id, state.config);
    }),
  );
};

export const startPreloadPlugin = async (id: string) => {
  const state = await config.plugins.getPluginState(id);
  await runner.start(id, state.config);
};

export const stopPreloadPlugin = (id: string) => runner.stop(id);

export const applyPreloadPluginConfig = (
  id: string,
  pluginConfig: Record<string, unknown>,
) => runner.applyConfig(id, pluginConfig);
