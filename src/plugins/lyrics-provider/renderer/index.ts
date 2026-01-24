import { createRenderer } from '@/utils';
import { setNetFetch, fetchLyrics, currentLyrics, lyricsStore, setLyricsStore, retrySearch, setConfig } from './store';

import type { RendererContext } from '@/types/contexts';

export let netFetch: (
  url: string,
  init?: RequestInit,
) => Promise<[number, string, Record<string, string>]>;

export const renderer = createRenderer({
  start(ctx: RendererContext) {
    netFetch = ctx.ipc.invoke.bind(ctx.ipc, 'lyrics-provider:fetch');
    setNetFetch(netFetch);
    setConfig(ctx.getConfig());
    ctx.ipc.on('peard:update-song-info', (info) => {
      fetchLyrics(info);
    });

    // Expose the lyrics API globally for other plugins
    (window as any).lyricsProvider = {
      fetchLyrics,
      currentLyrics,
      lyricsStore,
      setLyricsStore,
      retrySearch,
    };
  },
});