import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import backend from './main';
import { onMenu } from './menu';
import { scrobblerConfig } from './types';

export default createPlugin({
  name: () => t('plugins.scrobbler.name'),
  description: () => t('plugins.scrobbler.description'),
  restartNeeded: true,
  config: scrobblerConfig,
  menu: onMenu,
  backend,
});
