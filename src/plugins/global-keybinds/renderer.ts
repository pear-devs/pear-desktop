import { type GlobalKeybindsPluginConfig } from './index';

import type { RendererContext } from '@/types/contexts';
import type { MusicPlayer } from '@/types/music-player';

function $<E extends Element = Element>(selector: string) {
  return document.querySelector<E>(selector);
}

let api: MusicPlayer;

export const onPlayerApiReady = async (
  playerApi: MusicPlayer,
  context: RendererContext<GlobalKeybindsPluginConfig>,
) => {
  console.log('Global Keybinds Plugin: onPlayerApiReady called');
  api = playerApi;

  function updateVolumeSlider(volume: number) {
    // Slider value automatically rounds to multiples of 5
    for (const slider of ['#volume-slider', '#expand-volume-slider']) {
      const silderElement = $<HTMLInputElement>(slider);
      if (silderElement) {
        silderElement.value = String(volume > 0 && volume < 5 ? 5 : volume);
      }
    }
  }

  context.ipc.on('volumeUp', () => {
    const volume = Math.min(api.getVolume());
    api.setVolume(Math.min(volume + 5, 100));
    if (api.isMuted()) api.unMute();
    updateVolumeSlider(volume);
  });
  context.ipc.on('volumeDown', () => {
    const volume = Math.max(api.getVolume() - 5, 0);
    api.setVolume(volume);
    updateVolumeSlider(volume);
  });
  context.ipc.on('nextTrack', () => {
    api.nextVideo();
  });
  context.ipc.on('previousTrack', () => {
    api.previousVideo();
  });
  context.ipc.on('likeTrack', () => {
    const button = document.querySelector('#button-shape-like button');
    if (button)
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  context.ipc.on('dislikeTrack', () => {
    const button = document.querySelector('#button-shape-dislike button');
    if (button)
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

  context.ipc.on('tooglePlay', () => {
    switch (api.getPlayerState()) {
      case 1: // Playing
        api.pauseVideo();
        break;
      case 2: // Paused
        api.playVideo();
        break;
      default:
        break;
    }
  });
};
