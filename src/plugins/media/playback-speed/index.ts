import { createPlugin } from '@/utils';
import { onPlayerApiReady, onUnload } from './renderer';
import { t } from '@/i18n';

export default createPlugin({
  name: () => t('plugins.playback-speed.name'),
  description: () => t('plugins.playback-speed.description'),
  restartNeeded: false,
  config: {
    enabled: false,
  },
  renderer: {
    stop: onUnload,
    onPlayerApiReady,
  },
});
