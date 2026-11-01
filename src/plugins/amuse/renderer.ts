import { createRenderer } from '@/utils';

import type { MusicWidgetConfig } from './index';
import type { MusicPlayer } from '@/types/music-player';

// The song info that the Amuse API serves doesn't know about ads: while one
// plays it already shows the upcoming song. YouTube marks the player with the
// `ad-showing` class during ads, and the player API reports it as well.
const isAdPlaying = (api?: MusicPlayer) => {
  const player = document.querySelector('#movie_player');
  if (player?.classList.contains('ad-showing')) return true;
  try {
    return api?.getAdState() === 1;
  } catch {
    return false;
  }
};

export const renderer = createRenderer<
  {
    observer?: MutationObserver;
    lastState?: boolean;
  },
  MusicWidgetConfig
>({
  onPlayerApiReady(api, { ipc }) {
    const report = () => {
      const isAd = isAdPlaying(api);
      if (isAd === this.lastState) return;
      this.lastState = isAd;
      ipc.send('peard:amuse-ad-state', isAd);
    };

    const player = document.querySelector('#movie_player');
    if (player) {
      this.observer = new MutationObserver(report);
      this.observer.observe(player, {
        attributes: true,
        attributeFilter: ['class'],
      });
    }
    report();
  },
  stop() {
    this.observer?.disconnect();
    this.observer = undefined;
    this.lastState = undefined;
  },
});
