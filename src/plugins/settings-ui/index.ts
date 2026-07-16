import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { backend } from './backend';
import { renderer } from './renderer';
import style from './styles.css?inline';

export interface SettingsUIConfig {
  enabled: boolean;
}

export default createPlugin({
  name: () => t('settings-ui.name'),
  description: () => t('settings-ui.description'),
  restartNeeded: false,
  config: {
    enabled: true,
  } as SettingsUIConfig,
  stylesheets: [style],
  backend,
  renderer,
});
