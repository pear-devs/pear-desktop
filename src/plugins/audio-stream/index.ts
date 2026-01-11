import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { defaultAudioStreamConfig } from './config';
import { backend } from './backend';
import { onMenu } from './menu';
import { renderer } from './renderer';

export default createPlugin({
  name: () => t('plugins.audio-stream.name'),
  description: () => t('plugins.audio-stream.description'),
  restartNeeded: false,
  config: defaultAudioStreamConfig,
  backend,
  renderer,
  menu: onMenu,
});
