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
  menu: onMenu,
  backend,
});
