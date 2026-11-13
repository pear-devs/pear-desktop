import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import backend from './back';
import renderer from './renderer';
import { sponsorBlockConfig } from './types';

export default createPlugin({
  name: () => t('plugins.sponsorblock.name'),
  description: () => t('plugins.sponsorblock.description'),
  restartNeeded: true,
  config: sponsorBlockConfig,
  backend,
  renderer,
});
