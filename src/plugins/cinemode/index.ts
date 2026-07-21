import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { startCinemodeObserver } from './observer';

export default createPlugin({
  name: () => t('Cinemode'),
  description: () =>
    t(
      'Forces the player to always run in video mode. Useful for avoiding Youtube Music from switching modified songs to their original versions.',
    ),
  restartNeeded: false,
  config: {
    enabled: true,
  },

  renderer() {
    console.log('cinemode renderer');
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startCinemodeObserver);
    } else {
      startCinemodeObserver();
    }
  },
});
