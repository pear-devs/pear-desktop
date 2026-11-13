import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { downloaderConfig } from './config';
import backend from './main';
import { onMenu } from './menu';
import renderer from './renderer';
import style from './style.css?inline';

export default createPlugin({
  name: () => t('plugins.downloader.name'),
  description: () => t('plugins.downloader.description'),
  restartNeeded: true,
  config: downloaderConfig,
  stylesheets: [style],
  menu: onMenu,
  backend,
  renderer,
});
