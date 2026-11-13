import { t } from '@/i18n';
import { config } from '@/plugins/utils/common/config';
import { createPlugin } from '@/utils';

import type { VideoDataChanged } from '@/types/video-data-changed';

export default createPlugin({
  name: () => t('plugins.disable-autoplay.name'),
  description: () => t('plugins.disable-autoplay.description'),
  restartNeeded: false,
  config: {
    applyOnce: config.bool(false, {
      label: 'plugins.disable-autoplay.menu.apply-once',
    }),
  },
  renderer: (ctx) => {
    ctx.onPlayerApiReady((api) => {
      let done = false;

      const timeUpdateListener = (e: Event) => {
        if (e.target instanceof HTMLVideoElement) {
          e.target.pause();
        }
      };

      ctx.listen(
        document,
        'videodatachange',
        (event: CustomEvent<VideoDataChanged>) => {
          if (done) return;
          if (ctx.config.applyOnce) done = true;

          if (event.detail.name === 'dataloaded') {
            api.pauseVideo();
            const video = document.querySelector<HTMLVideoElement>('video');
            if (video) {
              ctx.listen(video, 'timeupdate', timeUpdateListener, {
                once: true,
              });
            }
          }
        },
      );
    });

    // `applyOnce` is read on the next video change; nothing to redo now.
    ctx.onConfigChange(() => {});
  },
});
