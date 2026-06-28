import { t } from '@/i18n';
import { createPlugin } from '@/utils';
import { waitForElement } from '@/utils/wait-for-element';

export default createPlugin<
  unknown,
  unknown,
  {
    observer?: MutationObserver;
    start(): void;
    stop(): void;
  }
>({
  name: () => t('plugins.skip-disliked-songs.name'),
  description: () => t('plugins.skip-disliked-songs.description'),
  restartNeeded: false,
  renderer: {
    start() {
      waitForElement<HTMLElement>('#like-button-renderer').then(
        (dislikeBtn) => {
          this.observer = new MutationObserver(() => {
            if (dislikeBtn?.getAttribute('like-status') == 'DISLIKE') {
              document
                .querySelector<HTMLButtonElement>('yt-icon-button.next-button')
                ?.click();
            }
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
      this.observer?.disconnect();
    },
  },
});
