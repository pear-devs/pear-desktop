import { createPlugin } from '@/utils';
import { t } from '@/i18n';

import style from './ui/styles.css?inline';

import type { StatsBackend } from './backend';

let backend: StatsBackend | null = null;

export default createPlugin({
  name: () => t('plugins.music-stats-dashboard.name', 'Music Stats Dashboard'),
  description: () =>
    t(
      'plugins.music-stats-dashboard.description',
      'Track your listening habits with detailed stats, wrapped-style summaries, and a comprehensive dashboard',
    ),
  restartNeeded: false,
  config: {
    enabled: false,
    remoteSyncEnabled: false,
    remoteSyncLastTime: '',
    remoteSyncLastError: '',
    cloudSyncEnabled: false,
    cloudSyncClientId: '',
    cloudSyncClientSecret: '',
    cloudSyncRefreshToken: '',
    cloudSyncAccessToken: '',
    cloudSyncAccessTokenExpiry: 0,
    cloudSyncFileId: '',
    cloudSyncLastSyncTime: '',
    cloudSyncLastHash: '',
    cloudSyncLastError: '',
  },
  stylesheets: [style],
  menu: async ({ getConfig, setConfig, window, refresh }) => {
    const config = await getConfig();
    if (!config.enabled) return [];

    const menuFn = (await import('./menu')).default;
    return menuFn({ getConfig, setConfig, window, refresh });
  },
  backend: {
    start: async (context) => {
      // Standard import works now because backend.ts is browser-safe at top-level
      const { StatsBackend } = await import('./backend');

      backend = new StatsBackend(context);
      await backend.initialize();
      console.log('[Music Stats Dashboard] Backend initialized');
    },
    onConfigChange: async (newConfig) => {
      await backend?.onConfigChange(newConfig);
    },
    stop: async () => {
      if (backend) {
        await backend.cleanup();
        backend = null;
      }
      console.log('[Music Stats Dashboard] Backend stopped');
    },
  },
  renderer: {
    start: async (context) => {
      const renderer = await import('./renderer');
      renderer.start(context);
    },
    stop: async () => {
      const renderer = await import('./renderer');
      renderer.stop();
    },
  },
});
