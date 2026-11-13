import { createRoot } from 'solid-js';

import { createRenderer } from '@/utils';
import { waitForElement } from '@/utils/wait-for-element';

import { applyLineEffect, setConfig, setCurrentTime } from './renderer';
import { fetchLyrics } from './store';
import { selectors, tabStates, unmountLyrics } from './utils';

import type { syncedLyricsConfig } from '../types';
import type { SongInfo } from '@/providers/song-info';
import type { MusicPlayer } from '@/types/music-player';

/** The player API of the running plugin (null while it isn't running). */
export let _ytAPI: MusicPlayer | null = null;

export default createRenderer<typeof syncedLyricsConfig>((ctx) => {
  setConfig({ ...ctx.config });
  ctx.onConfigChange((newConfig) => setConfig({ ...newConfig }));

  createRoot((dispose) => {
    applyLineEffect();
    ctx.onCleanup(dispose);
  });

  ctx.onCleanup(() => {
    unmountLyrics();
    _ytAPI = null;
    setConfig(null);
  });

  const observer = new MutationObserver((mutations) => {
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
  });
  ctx.onCleanup(() => observer.disconnect());

  let updateTimestampInterval: ReturnType<typeof setInterval> | undefined;

  const videoDataChange = async () => {
    updateTimestampInterval ??= ctx.setInterval(
      () => setCurrentTime((_ytAPI?.getCurrentTime() ?? 0) * 1000),
      100,
    );

    observer.disconnect();

    // Force the lyrics tab to be enabled at all times.
    const header = await waitForElement<HTMLElement>(selectors.head);
    if (ctx.signal.aborted) return;
    {
      header.removeAttribute('disabled');
      tabStates[header.ariaSelected ?? 'false']();
    }

    observer.observe(header, { attributes: true });
    header.removeAttribute('disabled');
  };

  ctx.onPlayerApiReady(async (api) => {
    _ytAPI = api;

    api.addEventListener('videodatachange', videoDataChange);
    ctx.onCleanup(() =>
      api.removeEventListener('videodatachange', videoDataChange),
    );

    await videoDataChange();
  });

  ctx.ipc.core.on('peard:update-song-info', (info: SongInfo) => {
    fetchLyrics(info);
  });
});
