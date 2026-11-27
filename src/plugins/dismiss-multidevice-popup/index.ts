import { t } from '@/i18n';
import { createPlugin } from '@/utils';

const CONFIRM_DIALOG = 'yt-confirm-dialog-renderer';
const PAPER_DIALOG = 'tp-yt-paper-dialog';

type ContinuePlaybackRenderer = HTMLElement & {
  data?: {
    confirmButton?: {
      buttonRenderer?: {
        navigationEndpoint?: {
          watchEndpoint?: {
            continuePlayback?: boolean;
          };
        };
      };
    };
  };
};

function isContinuePlaybackPrompt(el: Element): boolean {
  const data = (el as ContinuePlaybackRenderer).data;
  return (
    data?.confirmButton?.buttonRenderer?.navigationEndpoint?.watchEndpoint
      ?.continuePlayback === true
  );
}

export default createPlugin<unknown, unknown, { observer?: MutationObserver }>({
  name: () => t('plugins.dismiss-multidevice-popup.name'),
  description: () => t('plugins.dismiss-multidevice-popup.description'),
  addedVersion: '3.12.X',
  restartNeeded: false,
  renderer: {
    start() {
      const dismiss = () => {
        for (const renderer of document.querySelectorAll(CONFIRM_DIALOG)) {
          if (!isContinuePlaybackPrompt(renderer)) continue;
          const dialog = renderer.closest(PAPER_DIALOG);
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
          if (
            mutation.type === 'attributes' &&
            mutation.target instanceof Element &&
            mutation.target.matches(PAPER_DIALOG)
          ) {
            dismiss();
            return;
          }
          if (mutation.type !== 'childList') continue;
          for (const node of mutation.addedNodes) {
            if (
              node instanceof Element &&
              (node.matches(PAPER_DIALOG) ||
                node.matches(CONFIRM_DIALOG) ||
                node.querySelector(CONFIRM_DIALOG))
            ) {
              dismiss();
              return;
            }
          }
        }
      });
      this.observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'aria-hidden', 'opened'],
      });
    },
    stop() {
      this.observer?.disconnect();
    },
  },
});
