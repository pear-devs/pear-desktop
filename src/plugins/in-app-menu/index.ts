import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import backend from './main';
import renderer from './renderer';
import titlebarStyle from './titlebar.css?inline';
import { inAppMenuConfig, isEnabledByDefault } from './types';

export default createPlugin({
  name: () => t('plugins.in-app-menu.name'),
  description: () => t('plugins.in-app-menu.description'),
  restartNeeded: true,
  enabledByDefault: isEnabledByDefault,
  config: inAppMenuConfig,
  stylesheets: [titlebarStyle],
  backend,
  renderer,
});
