import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import backend from './back';
import renderer from './renderer';

export default createPlugin({
  name: () => t('plugins.quality-changer.name'),
  description: () => t('plugins.quality-changer.description'),
  restartNeeded: false,
  backend,
  renderer,
});
