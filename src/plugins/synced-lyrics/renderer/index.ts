import { createRenderer } from '@/utils';

import { makeLyricsRequest } from './lyrics';
import { selectors, tabStates } from './utils';
import { setConfig } from './renderer';
import { setCurrentTime } from './components/LyricsContainer';

import type { RendererContext } from '@/types/contexts';
import type { YoutubePlayer } from '@/types/youtube-player';
import type { SongInfo } from '@/providers/song-info';

import type { SyncedLyricsPluginConfig } from '../types';

export let _ytAPI: YoutubePlayer | null = null;

export const renderer = createRenderer<{
  observerCallback: MutationCallback;
  onPlayerApiReady: (api: YoutubePlayer) => void;
  hasAddedEvents: boolean;
  observer?: MutationObserver;
  videoDataChange: () => void;
  progressCallback: (evt: Event) => void;
}, SyncedLyricsPluginConfig>({
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
          tabStates[header.ariaSelected as 'true' | 'false']?.(
            _ytAPI?.getVideoData(),
          );
          break;
      }
    }
  },

  onPlayerApiReady(api: YoutubePlayer) {
    _ytAPI = api;

    api.addEventListener('videodatachange', this.videoDataChange);

    this.videoDataChange();
  },

  hasAddedEvents: false,

  videoDataChange() {
    if (!this.hasAddedEvents) {
      const video = document.querySelector('video');

      video?.addEventListener('timeupdate', this.progressCallback);

      if (video) this.hasAddedEvents = true;
    }

    const header = document.querySelector<HTMLElement>(selectors.head);
    if (!header) return;

    this.observer ??= new MutationObserver(
      this.observerCallback,
    );

    // Force the lyrics tab to be enabled at all times.
    this.observer.disconnect();
    this.observer.observe(header, { attributes: true });
    header.removeAttribute('disabled');
  },

  progressCallback(evt: Event) {
    switch (evt.type) {
      case 'timeupdate': {
        const video = evt.target as HTMLVideoElement;
        setCurrentTime(video.currentTime * 1000);
        break;
      }
    }
  },

  async start(ctx: RendererContext<SyncedLyricsPluginConfig>) {
    setConfig(await ctx.getConfig());

    ctx.ipc.on('ytmd:update-song-info', async (info: SongInfo) => {
      await makeLyricsRequest(info);
    });
  },
});
