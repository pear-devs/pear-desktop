import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import backend from './back';
import renderer from './renderer';
import { preciseVolumeConfig } from './types';
import hudStyle from './volume-hud.css?inline';

export default createPlugin({
  name: () => t('plugins.precise-volume.name'),
  description: () => t('plugins.precise-volume.description'),
  // The addEventListener override in override.ts can't be undone for the
  // listeners YTM skipped while it was active.
  restartNeeded: true,
  config: preciseVolumeConfig,
  stylesheets: [hudStyle],
  backend,
  renderer,
});
