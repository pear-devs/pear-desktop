import { createPlugin, createBackend } from '@/utils';
import { t } from '@/i18n';

import { startBlocker, startFromContext, stopBlocker } from './backend';

import type { BackendContext } from '@/types/contexts';

import type { AdblockerPluginConfig } from './config';

export type { AdblockerPluginConfig } from './config';

export default createPlugin({
  name: () => t('plugins.adblocker.name'),
  description: () => t('plugins.adblocker.description'),
  restartNeeded: false,
  config: {
    enabled: true,
    cache: true,
    additionalBlockLists: [],
  } as AdblockerPluginConfig,
  backend: createBackend<{ _noop?: undefined }, AdblockerPluginConfig>({
    async start(ctx: BackendContext<AdblockerPluginConfig>) {
      await startFromContext(ctx);
    },

    stop() {
      stopBlocker();
    },

    async onConfigChange(cfg: AdblockerPluginConfig) {
      stopBlocker();
      await startBlocker(cfg);
    },
  }),
});
