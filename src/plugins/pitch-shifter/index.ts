import { createPlugin } from '@/utils';
import { onPlayerApiReady, onUnload } from './renderer';
import { t } from '@/i18n';

export default createPlugin({
  name: () => t('plugins.pitch-shift.name'),
  description: () => t('plugins.pitch-shift.description'),
  authors: ['KimJammer'],
  restartNeeded: false,
  config: {
    enabled: false,
  },
  renderer: {
    stop: onUnload,
    onPlayerApiReady,
  },
});
