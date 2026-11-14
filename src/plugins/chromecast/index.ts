import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import type { CastBackend } from './backend';

export type ChromecastPluginConfig = {
  enabled: boolean;
  autoCastOnStartup: boolean;
  autoReconnectSuppressed: boolean;
  lastReceiverId: string;
  lastAppId: string;
};

export default createPlugin({
  name: () => t('plugins.chromecast.name'),
  description: () => t('plugins.chromecast.description'),
  restartNeeded: true,
  config: {
    enabled: true,
    autoCastOnStartup: false,
    autoReconnectSuppressed: false,
    lastReceiverId: '',
    lastAppId: '',
  } as ChromecastPluginConfig,
  menu: async ({ getConfig, setConfig }) => {
    const config = await getConfig();
    return [
      {
        label: t('plugins.chromecast.menu.auto-cast-on-startup'),
        type: 'checkbox',
        checked: config.autoCastOnStartup,
        click(item) {
          setConfig({
            autoCastOnStartup: item.checked,
            autoReconnectSuppressed: item.checked
              ? false
              : config.autoReconnectSuppressed,
          });
        },
      },
    ];
  },
  stylesheets: [
    '.right-content ytmusic-cast-button { display: inline-flex !important; }',
  ],
  renderer: {},
  backend: {
    service: null as CastBackend | null,
    async start({ window }) {
      const { CastBackend } = await import('./backend');
      this.service = new CastBackend(window);
      this.service.start();
    },
    stop() {
      this.service?.stop();
      this.service = null;
    },
  },
});
