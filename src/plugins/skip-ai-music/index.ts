import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { backend } from './backend';
import { onMenu } from './menu';
import { renderer } from './renderer';
import style from './style.css?inline';
import { defaultConfig } from './types';

export default createPlugin({
  name: () => t('plugins.skip-ai-music.name'),
  description: () => t('plugins.skip-ai-music.description'),
  restartNeeded: false,
  addedVersion: '3.12.X',
  config: defaultConfig,
  stylesheets: [style],
  menu: onMenu,
  backend,
  renderer,
});
