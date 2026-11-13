import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import backend from './back';
import renderer from './renderer';
import style from './style.css?inline';

export default createPlugin({
  name: () => t('plugins.music-together.name'),
  description: () => t('plugins.music-together.description'),
  restartNeeded: false,
  addedVersion: '3.2.X',
  stylesheets: [style],
  backend,
  renderer,
});
