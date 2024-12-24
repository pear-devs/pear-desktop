import { createRenderer } from '@/utils';
import { waitForElement } from '@/utils/wait-for-element';

import { selectors, tabStates } from './utils';
import { setConfig } from './renderer';
import { setCurrentTime } from './components/LyricsContainer';

import { fetchLyrics } from '../providers';

import type { RendererContext } from '@/types/contexts';
import type { YoutubePlayer } from '@/types/youtube-player';
import type { SongInfo } from '@/providers/song-info';
import type { SyncedLyricsPluginConfig } from '../types';

export let _ytAPI: YoutubePlayer | null = null;

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

  async onPlayerApiReady(api: YoutubePlayer) {
    _ytAPI = api;

    api.addEventListener('videodatachange', this.videoDataChange);

    await this.videoDataChange();
  },
  async videoDataChange() {
    if (!this.updateTimestampInterval) {
      this.updateTimestampInterval = setInterval(
        () => setCurrentTime((_ytAPI?.getCurrentTime() ?? 0) * 1000),
        100,
      );
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
    setConfig(await ctx.getConfig());

    ctx.ipc.on('ytmd:update-song-info', (info: SongInfo) => {
      fetchLyrics(info);
    });
  },
});
