import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { backend } from './backend';
import { defaultAPIServerConfig } from './config';
import { onMenu } from './menu';
import {
  onRendererConfigChange,
  onRendererLoad,
  onRendererUnload,
} from './renderer';

export default createPlugin({
  name: () => t('plugins.api-server.name'),
  description: () => t('plugins.api-server.description'),
  restartNeeded: false,
  config: defaultAPIServerConfig,
  addedVersion: '3.6.X',
  menu: onMenu,

  backend,

  renderer: {
    start: onRendererLoad,
    onConfigChange: onRendererConfigChange,
    stop: onRendererUnload,
  },
});
