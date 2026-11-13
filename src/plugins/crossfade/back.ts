import { Innertube } from 'youtubei.js';

import { getNetFetchAsFetch } from '@/plugins/utils/main';
import { createBackend } from '@/utils';

import type { CrossfadeIpc, crossfadeConfig } from './types';

export default createBackend<typeof crossfadeConfig, CrossfadeIpc>(
  async (ctx) => {
    // The backend doesn't depend on the config; don't restart on changes.
    ctx.onConfigChange(() => {});

    const yt = await Innertube.create({
      fetch: getNetFetchAsFetch(),
    });
    if (ctx.signal.aborted) return;

    ctx.ipc.handle('audioUrl', async (videoID) => {
      const info = await yt.getBasicInfo(videoID);
      return info.streaming_data?.formats[0].decipher(yt.session.player);
    });
  },
);
