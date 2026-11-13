import { t } from '@/i18n';
import { createPlugin } from '@/utils';

export default createPlugin({
  name: () => t('plugins.skip-disliked-songs.name'),
  description: () => t('plugins.skip-disliked-songs.description'),
  restartNeeded: false,
  renderer: (ctx) => {
    const observeLikeButton = (likeButton: HTMLElement) => {
      ctx.observe(
        likeButton,
        { attributes: true, childList: false, subtree: false },
        () => {
          if (likeButton.getAttribute('like-status') == 'DISLIKE') {
            document
              .querySelector<HTMLButtonElement>('yt-icon-button.next-button')
              ?.click();
          }
        },
      );
    };

    // Waits for the like button; the polling stops with the plugin.
    const find = () =>
      document.querySelector<HTMLElement>('#like-button-renderer');
    const likeButton = find();
    if (likeButton) {
      observeLikeButton(likeButton);
      return;
    }
    const interval = ctx.setInterval(() => {
      const element = find();
      if (!element) return;
      ctx.clearInterval(interval);
      observeLikeButton(element);
    }, 100);
  },
});
