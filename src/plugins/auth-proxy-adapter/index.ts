import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import backend from './backend';
import { authProxyConfig } from './config';

export default createPlugin({
  name: () => t('plugins.auth-proxy-adapter.name'),
  description: () => t('plugins.auth-proxy-adapter.description'),
  restartNeeded: true,
  config: authProxyConfig,
  addedVersion: '3.10.X',
  backend,
});
