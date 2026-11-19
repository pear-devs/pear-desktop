import { getSongInfo } from '@/providers/song-info-front';
import { createRenderer } from '@/utils';
import { waitForElement } from '@/utils/wait-for-element';

import { disposeReactiveRoot } from './reactive-root';
import { setConfig, setCurrentTime } from './renderer';
import { fetchLyrics } from './store';
import { activeTrack, isCurrentTrack, setPlayer, syncTrack } from './track';
import { selectors, tabStates } from './utils';

import type { SyncedLyricsPluginConfig } from '../types';
import type { SongInfo } from '@/providers/song-info';
import type { RendererContext } from '@/types/contexts';
import type { MusicPlayer } from '@/types/music-player';

export let _ytAPI: MusicPlayer | null = null;
export let netFetch: (
  url: string,
  init?: RequestInit,
) => Promise<[number, string, Record<string, string>]>;

let fetchedGeneration = -1;
const refreshLyrics = (info: SongInfo = getSongInfo()) => {
  syncTrack();
  const track = activeTrack();
  if (
    track.generation === fetchedGeneration ||
    info.videoId !== track.videoId ||
    !isCurrentTrack(track)
  )
    return;
  fetchLyrics(info);
  fetchedGeneration = track.generation;
};

export const renderer = createRenderer<
  {
    observerCallback: MutationCallback;
    observer?: MutationObserver;
    videoDataChange: () => Promise<void>;
    updateTimestampInterval?: NodeJS.Timeout | string | number;
  },
  SyncedLyricsPluginConfig
>({
  onConfigChange(newConfig) {
    setConfig(newConfig);
  },

  observerCallback(mutations: MutationRecord[]) {
    for (const mutation of mutations) {
      const header = mutation.target as HTMLElement;

      switch (mutation.attributeName) {
        case 'disabled':
          header.removeAttribute('disabled');
          break;
        case 'aria-selected':
          tabStates[header.ariaSelected ?? 'false']();
          break;
      }
    }
  },

  async onPlayerApiReady(api: MusicPlayer) {
    _ytAPI = api;
    setPlayer(api);

    api.addEventListener('videodatachange', this.videoDataChange);

    await this.videoDataChange();
  },
  async videoDataChange() {
    refreshLyrics();
    if (!this.updateTimestampInterval) {
      this.updateTimestampInterval = setInterval(() => {
        // Metadata and player readiness may arrive in either order.
        refreshLyrics();
        setCurrentTime((_ytAPI?.getCurrentTime() ?? 0) * 1000);
      }, 100);
    }

    // prettier-ignore
    this.observer ??= new MutationObserver(this.observerCallback);
    this.observer.disconnect();

    // Force the lyrics tab to be enabled at all times.
    const header = await waitForElement<HTMLElement>(selectors.head);
    {
      header.removeAttribute('disabled');
      tabStates[header.ariaSelected ?? 'false']();
    }

    this.observer.observe(header, { attributes: true });
    header.removeAttribute('disabled');
  },

  async start(ctx: RendererContext<SyncedLyricsPluginConfig>) {
    netFetch = ctx.ipc.invoke.bind(ctx.ipc, 'synced-lyrics:fetch');

    setConfig(await ctx.getConfig());

    ctx.ipc.on('peard:update-song-info', (info: SongInfo) => {
      refreshLyrics(info);
    });
  },

  stop() {
    _ytAPI?.removeEventListener('videodatachange', this.videoDataChange);
    if (this.updateTimestampInterval)
      clearInterval(
        this.updateTimestampInterval as ReturnType<typeof setInterval>,
      );
    this.observer?.disconnect();
    setPlayer(null);
    _ytAPI = null;
    fetchedGeneration = -1;
    disposeReactiveRoot();
  },
});
