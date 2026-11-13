import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import backend from './main';
import { onMenu } from './menu';
import { discordConfig } from './types';

export default createPlugin({
  name: () => t('plugins.discord.name'),
  description: () => t('plugins.discord.description'),
  restartNeeded: false,
  config: discordConfig,
  menu: onMenu,
  backend,
});
