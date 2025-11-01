import { createPlugin } from '@/utils';
import { t } from '@/i18n';

import { defaultAPIServerConfig } from './config';
import { onMenu } from './menu';
import { backend } from './backend';

export default createPlugin({
  name: () => t('plugins.api-server.name'),
  description: () => t('plugins.api-server.description'),
  restartNeeded: false,
  config: defaultAPIServerConfig,
  addedVersion: '3.6.X',
  menu: onMenu,

  backend,
});
