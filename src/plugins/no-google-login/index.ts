import style from './style.css?inline';
import { createPlugin } from '@/utils';
import { t } from '@/i18n';

export default createPlugin({
  name: () => t('plugins.no-google-login.name'),
  description: () => t('plugins.no-google-login.description'),
  restartNeeded: true,
  config: {
    enabled: false,
  },
  stylesheets: [style],
  renderer() {
    const elementsToRemove = [
      '.sign-in-link.ytmusic-nav-bar',
      '.ytmusic-pivot-bar-renderer[tab-id="FEmusic_liked"]',
    ];

    for (const selector of elementsToRemove) {
      const node = document.querySelector(selector);
      if (node) {
        node.remove();
      }
    }
  },
});
