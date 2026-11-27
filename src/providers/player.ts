import type { GetState, VolumeState } from '@/types/datahost-get-state';
import type { MusicPlayer } from '@/types/music-player';

type PlayerApi = HTMLElement & MusicPlayer;
type PlayerListener = (
  api: PlayerApi | null,
  video: HTMLVideoElement | null,
) => void;
export const PRECISE_VOLUME_UPDATED = 'peard:precise-volume-updated';

export const getPlayerApi = () =>
  document.querySelector<PlayerApi>('#movie_player');

const findPlayerVideo = (player: PlayerApi | null) =>
  player?.querySelector<HTMLVideoElement>('video.html5-main-video') ??
  player?.querySelector('video') ??
  document.querySelector<HTMLVideoElement>(
    '#player video, ytmusic-player video, video.html5-main-video',
  );

export const getPlayerVideo = () => findPlayerVideo(getPlayerApi());

const getPlayerBarState = () =>
  document
    .querySelector<HTMLElement & { getState?: () => GetState }>(
      'ytmusic-player-bar',
    )
    ?.getState?.()?.player;

let preciseVolume: {
  api: MusicPlayer;
  volume: number;
  barVolume: number | undefined;
} | null = null;

export const setPrecisePlayerVolume = (api: MusicPlayer, volume: number) => {
  api.setVolume(volume);
  preciseVolume = {
    api,
    volume: api.getVolume(),
    barVolume: getPlayerBarState()?.volume,
  };
  document.dispatchEvent(new Event(PRECISE_VOLUME_UPDATED));
};

export const getPlayerVolume = (): VolumeState | undefined => {
  const api = getPlayerApi();
  const player = getPlayerBarState();

  // Precise Volume writes to the API without updating the player-bar state.
  // Drop that reading when the player or either volume value changes.
  if (
    preciseVolume &&
    (preciseVolume.api !== api ||
      preciseVolume.barVolume !== player?.volume ||
      preciseVolume.volume !== api?.getVolume?.())
  ) {
    preciseVolume = null;
  }

  const state = preciseVolume?.volume ?? player?.volume ?? api?.getVolume?.();
  const isMuted = preciseVolume
    ? (api?.isMuted?.() ?? player?.muted)
    : (player?.muted ?? api?.isMuted?.());
  if (state !== undefined && isMuted !== undefined) return { state, isMuted };
  return undefined;
};

export const listenToPlayerVideo = (
  type: keyof HTMLVideoElementEventMap | 'peard:src-changed',
  listener: (video: HTMLVideoElement) => void,
) => {
  // Media events such as volumechange and seeked do not bubble.
  const handler = (event: Event) => {
    const video = getPlayerVideo();
    if (video && event.target === video) {
      listener(video);
    }
  };
  document.addEventListener(type, handler, true);
  return () => document.removeEventListener(type, handler, true);
};

const playerListeners = new Set<PlayerListener>();
let currentApi: PlayerApi | null = null;
let currentVideo: HTMLVideoElement | null = null;

export const observePlayer = (listener: PlayerListener) => {
  if (playerListeners.size === 0) {
    currentApi = getPlayerApi();
    currentVideo = findPlayerVideo(currentApi);

    const observer = new MutationObserver(() => {
      const api = getPlayerApi();
      const video = findPlayerVideo(api);
      if (api === currentApi && video === currentVideo) return;

      currentApi = api;
      currentVideo = video;
      for (const onChange of playerListeners) {
        onChange(api, video);
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['id'],
    });
  }
  playerListeners.add(listener);
  listener(currentApi, currentVideo);
};
