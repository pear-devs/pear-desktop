import { ElectronBlocker } from '@ghostery/adblocker-electron';
import { session } from 'electron';

import { createPlugin } from '@/utils';
import { t } from '@/i18n';

import type { BackendContext } from '@/types/contexts';

export type AdBlockerPluginConfig = {
  enabled: boolean;
  cache: boolean;
  additionalBlockLists: string[];
};

let blocker: ElectronBlocker | null = null;

const defaultBlockLists = [
  'https://easylist.to/easylist/easylist.txt',
  'https://easylist.to/easylist/easyprivacy.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/badware.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/privacy.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/resource-abuse.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/unbreak.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/annoyances.txt',
];

export default createPlugin({
  name: () => t('plugins.adblocker.name'),
  description: () => t('plugins.adblocker.description'),
  restartNeeded: false,
  config: {
    enabled: true,
    cache: true,
    additionalBlockLists: [],
  },
  backend: {
    async start({ getConfig }: BackendContext<AdBlockerPluginConfig>) {
      const config = await getConfig();
      const blockLists = [...defaultBlockLists, ...config.additionalBlockLists];

      try {
        blocker = await ElectronBlocker.fromLists(
          fetch,
          blockLists,
          {
            enableCompression: true,
          },
        );

        blocker.enableBlockingInSession(session.defaultSession);

        console.log('[AdBlocker] Ad blocker enabled successfully');
      } catch (error) {
        console.error('[AdBlocker] Failed to initialize ad blocker:', error);
      }
    },

    async onConfigChange(newConfig: AdBlockerPluginConfig) {
      if (!newConfig.enabled && blocker) {
        blocker.disableBlockingInSession(session.defaultSession);
        blocker = null;
        console.log('[AdBlocker] Ad blocker disabled');
      }
    },

    stop() {
      if (blocker) {
        blocker.disableBlockingInSession(session.defaultSession);
        blocker = null;
        console.log('[AdBlocker] Ad blocker stopped');
      }
    },
  },
});
