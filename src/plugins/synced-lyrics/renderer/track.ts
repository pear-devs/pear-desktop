import { createSignal } from 'solid-js';

import type { MusicPlayer } from '@/types/music-player';

export type Track = { videoId: string; generation: number };
export const [activeTrack, setActiveTrack] = createSignal<Track>({
  videoId: '',
  generation: 0,
});

let player: MusicPlayer | null = null;

export const getLiveVideoId = () => player?.getVideoData()?.video_id ?? '';

export const syncTrack = () => {
  const videoId = getLiveVideoId();
  setActiveTrack((previous) =>
    previous.videoId === videoId
      ? previous
      : { videoId, generation: previous.generation + 1 },
  );
};

export const setPlayer = (api: MusicPlayer | null) => {
  player = api;
  syncTrack();
};

export const isCurrentTrack = (track: Track) =>
  activeTrack().generation === track.generation &&
  activeTrack().videoId === track.videoId &&
  getLiveVideoId() === track.videoId;

export const skipCurrentTrack = (track: Track) => {
  // Use the API supplied by onPlayerApiReady; ytmusic-app.playerApi is not
  // exposed in all versions of the YouTube Music web app.
  const api = player;
  if (!api || !isCurrentTrack(track)) return false;
  api.nextVideo();
  return true;
};
