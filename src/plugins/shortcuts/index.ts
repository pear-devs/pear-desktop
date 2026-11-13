import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import backend from './main';
import { shortcutsConfig } from './types';

export default createPlugin({
  name: () => t('plugins.shortcuts.name'),
  description: () => t('plugins.shortcuts.description'),
  restartNeeded: true,
  config: shortcutsConfig,
  backend,
});
