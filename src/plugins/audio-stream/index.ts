import { t } from '@/i18n';
import { createPlugin } from '@/utils';
import { backend } from './backend';
import { renderer } from './renderer';
import { onMenu } from './menu';
import { defaultAudioStreamConfig } from './config';
import type { AudioStreamConfig } from './config';

export default createPlugin({
  name: () => t('plugins.audio-stream.name'),
  description: () => t('plugins.audio-stream.description'),
  restartNeeded: false,
  config: defaultAudioStreamConfig as AudioStreamConfig,
  backend,
  renderer,
  menu: onMenu,
});

