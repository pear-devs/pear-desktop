import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { backend } from './backend';
import { defaultAPIServerConfig } from './config';
import { onMenu } from './menu';

export default createPlugin({
  name: () => t('plugins.api-server.name'),
  description: () => t('plugins.api-server.description'),
  restartNeeded: false,
  config: defaultAPIServerConfig,
  addedVersion: '3.6.X',
  menu: onMenu,

  backend,
});
