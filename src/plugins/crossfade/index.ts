import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import backend from './back';
import { menu } from './menu';
import renderer from './renderer';
import { crossfadeConfig } from './types';

export default createPlugin({
  name: () => t('plugins.crossfade.name'),
  description: () => t('plugins.crossfade.description'),
  restartNeeded: true,
  config: crossfadeConfig,
  menu,
  backend,
  renderer,
});
