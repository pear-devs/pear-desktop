import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { backend } from './backend';
import { defaultAuthProxyConfig } from './config';
import { onMenu } from './menu';

export default createPlugin({
  name: () => t('plugins.auth-proxy-adapter.name'),
  description: () => t('plugins.auth-proxy-adapter.description'),
  restartNeeded: true,
  config: defaultAuthProxyConfig,
  addedVersion: '3.10.X',
  settings: [
    {
      type: 'text',
      key: 'hostname',
      label: () => t('plugins.auth-proxy-adapter.menu.hostname.label'),
    },
    {
      type: 'number',
      key: 'port',
      label: () => t('plugins.auth-proxy-adapter.menu.port.label'),
      min: 0,
      max: 65535,
    },
  ],
  menu: onMenu,
  backend,
});
