import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import renderer from './renderer';

export default createPlugin({
  name: () => t('plugins.album-actions.name'),
  description: () => t('plugins.album-actions.description'),
  restartNeeded: false,
  addedVersion: '3.2.X',
  renderer,
});
