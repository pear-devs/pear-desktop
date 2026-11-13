import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import backend from './backend';
import { apiServerConfig } from './config';
import { onMenu } from './menu';

export default createPlugin({
  name: () => t('plugins.api-server.name'),
  description: () => t('plugins.api-server.description'),
  restartNeeded: false,
  config: apiServerConfig,
  addedVersion: '3.6.X',
  menu: onMenu,

  backend,
});
