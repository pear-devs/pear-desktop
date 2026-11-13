import { createRenderer } from '@/utils';

import type { Segment, SponsorBlockIpc, sponsorBlockConfig } from './types';

export default createRenderer<typeof sponsorBlockConfig, SponsorBlockIpc>(
  (ctx) => {
    let currentSegments: Segment[] = [];

    // The segments come from the backend; the config isn't used here.
    ctx.onConfigChange(() => {});

    ctx.ipc.on('skip', (segments) => {
      currentSegments = segments;
    });

    ctx.onPlayerApiReady(() => {
      const video = document.querySelector<HTMLVideoElement>('video');
      if (!video) return;

      ctx.listen(video, 'timeupdate', () => {
        for (const segment of currentSegments) {
          if (
            video.currentTime >= segment[0] &&
            video.currentTime < segment[1]
          ) {
            video.currentTime = segment[1];
            if (window.electronIs.dev()) {
              console.log('SponsorBlock: skipping segment', segment);
            }
          }
        }
      });
      // Reset segments on song end
      ctx.listen(video, 'emptied', () => {
        currentSegments = [];
      });
    });
  },
);
