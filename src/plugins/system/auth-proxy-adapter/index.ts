import { createPlugin } from '@/utils';
import { t } from '@/i18n';

import { defaultAuthProxyConfig } from './config';
import { onMenu } from './menu';
import { backend } from './backend';

export default createPlugin({
  name: () => t('plugins.auth-proxy-adapter.name'),
  description: () => t('plugins.auth-proxy-adapter.description'),
  restartNeeded: true,
  config: defaultAuthProxyConfig,
  addedVersion: '3.10.X',
  menu: onMenu,
  backend,
});
