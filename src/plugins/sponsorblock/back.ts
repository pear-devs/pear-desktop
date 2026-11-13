import is from 'electron-is';

import { createBackend } from '@/utils';

import { sortSegments } from './segments';

import type { SkipSegment, SponsorBlockIpc, sponsorBlockConfig } from './types';
import type { GetPlayerResponse } from '@/types/get-player-response';

export default createBackend<typeof sponsorBlockConfig, SponsorBlockIpc>(
  (ctx) => {
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
          signal: ctx.signal,
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

    // The config is read for each video; nothing to redo on a change.
    ctx.onConfigChange(() => {});

    ctx.ipc.core.on(
      'peard:video-src-changed',
      async (data: GetPlayerResponse) => {
        const { apiURL, categories } = ctx.config;
        const segments = await fetchSegments(
          apiURL,
          categories,
          data?.videoDetails?.videoId,
        );
        if (ctx.signal.aborted) return;
        ctx.ipc.send('skip', segments);
      },
    );
  },
);
