import { t } from '@/i18n';
import { createPlugin } from '@/utils';
import { waitForElement } from '@/utils/wait-for-element';

export default createPlugin<
  unknown,
  unknown,
  {
    observer?: MutationObserver;
    stopRequested?: boolean;
    start(): void;
    stop(): void;
  }
>({
  name: () => t('plugins.skip-disliked-songs.name'),
  description: () => t('plugins.skip-disliked-songs.description'),
  restartNeeded: false,
  renderer: {
    start() {
      this.stopRequested = false;
      waitForElement<HTMLElement>('#like-button-renderer').then(
        (dislikeBtn) => {
          if (this.stopRequested || !dislikeBtn) return;

          let lastStatus = dislikeBtn.getAttribute('like-status');
          this.observer = new MutationObserver(() => {
            const status = dislikeBtn.getAttribute('like-status');
            if (status === 'DISLIKE' && lastStatus !== 'DISLIKE') {
              document
                .querySelector<HTMLButtonElement>('yt-icon-button.next-button')
                ?.click();
            }
            lastStatus = status;
          });
          this.observer.observe(dislikeBtn, {
            attributes: true,
            childList: false,
            subtree: false,
          });
        },
      );
    },
    stop() {
      this.stopRequested = true;
      this.observer?.disconnect();
      this.observer = undefined;
    },
  },
});
