import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import emptyStyle from './empty-player.css?inline';
import renderer from './renderer';
import { visualizerConfig } from './types';

export default createPlugin({
  name: () => t('plugins.visualizer.name'),
  description: () => t('plugins.visualizer.description'),
  restartNeeded: false,
  config: visualizerConfig,
  stylesheets: [emptyStyle],
  renderer,
});
