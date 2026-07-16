import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { backend } from './backend';
import { AuthStrategy, defaultAPIServerConfig } from './config';
import { onMenu } from './menu';

export default createPlugin({
  name: () => t('plugins.api-server.name'),
  description: () => t('plugins.api-server.description'),
  restartNeeded: false,
  config: defaultAPIServerConfig,
  addedVersion: '3.6.X',
  settings: [
    {
      type: 'text',
      key: 'hostname',
      label: () => t('plugins.api-server.menu.hostname.label'),
      restartNeeded: true,
    },
    {
      type: 'number',
      key: 'port',
      label: () => t('plugins.api-server.menu.port.label'),
      min: 0,
      max: 65535,
      restartNeeded: true,
    },
    {
      type: 'select',
      key: 'authStrategy',
      label: () => t('plugins.api-server.menu.auth-strategy.label'),
      options: [
        {
          value: AuthStrategy.AUTH_AT_FIRST,
          label: () =>
            t(
              'plugins.api-server.menu.auth-strategy.submenu.auth-at-first.label',
            ),
        },
        {
          value: AuthStrategy.NONE,
          label: () =>
            t('plugins.api-server.menu.auth-strategy.submenu.none.label'),
        },
      ],
    },
    {
      type: 'switch',
      key: 'useHttps',
      label: () => t('plugins.api-server.menu.https.label'),
      restartNeeded: true,
    },
  ],
  menu: onMenu,

  backend,
});
