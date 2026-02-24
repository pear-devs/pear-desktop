import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { renderer } from './renderer';
import style from './styles.css?inline';
import { backend } from './backend';

export default createPlugin({
  name: () => t('plugins.settings-ui.name'),
  description: () => t('plugins.settings-ui.description'),
  restartNeeded: false,
  config: { enabled: true },
  stylesheets: [style],
  renderer,
  backend,
});
