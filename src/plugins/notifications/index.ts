import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import backend from './main';
import { onMenu } from './menu';
import { notificationsConfig } from './types';

export default createPlugin({
  name: () => t('plugins.notifications.name'),
  description: () => t('plugins.notifications.description'),
  restartNeeded: true,
  config: notificationsConfig,
  menu: onMenu,
  backend,
});
