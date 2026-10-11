import { t } from '@/i18n';
import { createPlugin } from '@/utils';
import { waitForElement } from '@/utils/wait-for-element';

import type { MusicPlayer } from '@/types/music-player';

const CONFIRM_DELAY_MS = 1000;
const REARM_MS = 1500;

let lastSkipVideoId = '';
let lastSkipTime = 0;
let observer: MutationObserver | undefined;
let confirmTimer: ReturnType<typeof setTimeout> | undefined;

const isRecentlySkipped = (videoId: string) =>
  videoId === lastSkipVideoId && Date.now() - lastSkipTime < REARM_MS;

export default createPlugin<
  unknown,
  unknown,
  {
    dislikeBtn?: HTMLElement;
    playerApi?: MusicPlayer;
    start(): void;
    stop(): void;
    onPlayerApiReady(api: MusicPlayer): void;
    proposeSkip(): void;
  }
>({
  name: () => t('plugins.skip-disliked-songs.name'),
  description: () => t('plugins.skip-disliked-songs.description'),
  restartNeeded: false,
  renderer: {
    proposeSkip() {
      const { playerApi, dislikeBtn } = this;
      if (!playerApi || !dislikeBtn) return;

      const videoId = playerApi.getVideoData?.()?.video_id;
      if (!videoId || isRecentlySkipped(videoId)) return;
      if (dislikeBtn.getAttribute('like-status') !== 'DISLIKE') return;

      clearTimeout(confirmTimer);
      confirmTimer = setTimeout(() => {
        const stillDisliked =
          playerApi.getVideoData?.()?.video_id === videoId &&
          dislikeBtn.getAttribute('like-status') === 'DISLIKE';

        if (stillDisliked && !isRecentlySkipped(videoId)) {
          lastSkipVideoId = videoId;
          lastSkipTime = Date.now();
          playerApi.nextVideo();
        }
      }, CONFIRM_DELAY_MS);
    },

    onPlayerApiReady(api: MusicPlayer) {
      this.playerApi = api;
      api.addEventListener('videodatachange', () => this.proposeSkip());
      this.proposeSkip();
    },

    start() {
      observer?.disconnect();

      waitForElement<HTMLElement>('#like-button-renderer').then(
        (dislikeBtn) => {
          this.dislikeBtn = dislikeBtn;

          observer = new MutationObserver((mutations) => {
            if (mutations.some((m) => m.attributeName === 'like-status')) {
              this.proposeSkip();
            }
          });

          observer.observe(dislikeBtn, {
            attributes: true,
            childList: false,
            subtree: false,
            attributeFilter: ['like-status'],
          });

          this.proposeSkip();
        },
      );
    },

    stop() {
      observer?.disconnect();
      observer = undefined;
      clearTimeout(confirmTimer);
      this.playerApi = undefined;
      lastSkipVideoId = '';
      lastSkipTime = 0;
    },
  },
});
