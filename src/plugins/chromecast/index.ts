import { createPlugin } from '@/utils';
import { t } from '@/i18n';

import {
  onBackendConfigChange,
  onBackendStart,
  onBackendStop,
} from './backend';
import { menu } from './menu';
import { renderer } from './renderer';
import { defaultConfig } from './types';

import style from './style.css?inline';

export default createPlugin({
  name: () => t('plugins.chromecast.name'),
  description: () => t('plugins.chromecast.description'),
  restartNeeded: true,
  config: defaultConfig,
  stylesheets: [style],
  menu,
  backend: {
    start: onBackendStart,
    stop: onBackendStop,
    onConfigChange: onBackendConfigChange,
  },
  renderer,
});
