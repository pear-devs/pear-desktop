import { t } from '@/i18n';
import { createPlugin } from '@/utils';

const MULTIDEVICE_RENDERER = 'ytmusic-you-there-renderer';

export default createPlugin<unknown, unknown, { observer?: MutationObserver }>({
  name: () => t('plugins.dismiss-multidevice-popup.name'),
  description: () => t('plugins.dismiss-multidevice-popup.description'),
  addedVersion: '3.12.X',
  restartNeeded: false,
  renderer: {
    start() {
      const dismiss = () => {
        for (const el of document.querySelectorAll(MULTIDEVICE_RENDERER)) {
          const dialog = el.closest('tp-yt-paper-dialog');
          if (!dialog) continue;
          const closeable = dialog as HTMLElement & { close?: () => void };
          if (typeof closeable.close === 'function') {
            closeable.close();
          } else {
            dialog.remove();
          }
        }
      };

      dismiss();

      this.observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (
              node instanceof HTMLElement &&
              (node.matches(MULTIDEVICE_RENDERER) ||
                node.querySelector(MULTIDEVICE_RENDERER))
            ) {
              dismiss();
            }
          }
        }
      });
      this.observer.observe(document.body, { childList: true, subtree: true });
    },
    stop() {
      this.observer?.disconnect();
    },
  },
});
