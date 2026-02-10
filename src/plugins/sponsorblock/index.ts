import is from 'electron-is';

import { createPlugin } from '@/utils';

import { sortSegments } from './segments';

import { t } from '@/i18n';

import type { GetPlayerResponse } from '@/types/get-player-response';
import type { Segment, SkipSegment } from './types';

export type SponsorBlockPluginConfig = {
  enabled: boolean;
  apiURL: string;
  categories: (
    | 'sponsor'
    | 'intro'
    | 'outro'
    | 'interaction'
    | 'selfpromo'
    | 'music_offtopic'
  )[];
};

let currentSegments: Segment[] = [];

export default createPlugin({
  name: () => t('plugins.sponsorblock.name'),
  description: () => t('plugins.sponsorblock.description'),
  restartNeeded: true,
  config: {
    enabled: false,
    apiURL: 'https://sponsor.ajay.app',
    categories: [
      'sponsor',
      'intro',
      'outro',
      'interaction',
      'selfpromo',
      'music_offtopic',
    ],
  } as SponsorBlockPluginConfig,
  async backend({ getConfig, ipc }) {
    const fetchSegments = async (
      apiURL: string,
      categories: string[],
      videoId: string,
    ) => {
      const sponsorBlockURL = `${apiURL}/api/skipSegments?videoID=${videoId}&categories=${JSON.stringify(
        categories,
      )}`;
      try {
        const resp = await fetch(sponsorBlockURL, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
          redirect: 'follow',
        });
        if (resp.status !== 200) {
          return [];
        }

        const segments = (await resp.json()) as SkipSegment[];
        return sortSegments(segments.map((submission) => submission.segment));
      } catch (error) {
        if (is.dev()) {
          console.log('error on sponsorblock request:', error);
        }

        return [];
      }
    };

    const config = await getConfig();

    const { apiURL, categories } = config;

    ipc.on('peard:video-src-changed', async (data: GetPlayerResponse) => {
      const segments = await fetchSegments(
        apiURL,
        categories,
        data?.videoDetails?.videoId,
      );
      ipc.send('sponsorblock-skip', segments);
    });
  },
  renderer: {
    timeUpdateListener: (e: Event) => {
      if (e.target instanceof HTMLVideoElement) {
        const target = e.target;

        for (const segment of currentSegments) {
          if (
            target.currentTime >= segment[0] &&
            target.currentTime < segment[1]
          ) {
            target.currentTime = segment[1];
            if (window.electronIs.dev()) {
              console.log('SponsorBlock: skipping segment', segment);
            }
          }
        }
      }
    },
    resetSegments: () => (currentSegments = []),
    start({ ipc }) {
      ipc.on('sponsorblock-skip', (segments: Segment[]) => {
        currentSegments = segments;
      });
    },
    onPlayerApiReady() {
      const video = document.querySelector<HTMLVideoElement>('video');
      if (!video) return;

      video.addEventListener('timeupdate', this.timeUpdateListener);
      // Reset segments on song end
      video.addEventListener('emptied', this.resetSegments);
    },
    stop() {
      const video = document.querySelector<HTMLVideoElement>('video');
      if (!video) return;

      video.removeEventListener('timeupdate', this.timeUpdateListener);
      video.removeEventListener('emptied', this.resetSegments);
    },
  },
});
