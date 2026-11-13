import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import backend from './main';
import renderer from './renderer';
import style from './style.css?inline';
import { pictureInPictureConfig } from './types';

export default createPlugin({
  name: () => t('plugins.picture-in-picture.name'),
  description: () => t('plugins.picture-in-picture.description'),
  restartNeeded: true,
  config: pictureInPictureConfig,
  stylesheets: [style],
  backend,
  renderer,
});
