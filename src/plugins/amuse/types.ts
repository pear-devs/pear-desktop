export interface PlayerInfo {
  hasSong: boolean;
  isPaused: boolean;
  seekbarCurrentPosition: number;
  /** Unix ms at which seekbarCurrentPosition was measured */
  positionUpdatedAt: number;
}

export interface TrackInfo {
  author: string;
  title: string;
  cover: string;
  duration: number;
  url: string;
  id: string;
  isAdvertisement: boolean;
  album: string | null;
  /** AUDIO, ORIGINAL_MUSIC_VIDEO, USER_GENERATED_CONTENT, PODCAST_EPISODE or OTHER_VIDEO */
  mediaType: string;
  playlistId: string | null;
}

export interface AmuseSongInfo {
  /**
   * 2: isAdvertisement is detected, the position is live and the fields
   * above exist. Missing in older versions, where isAdvertisement was
   * always false and the position only changed on play, pause or seek.
   */
  apiVersion: 2;
  player: PlayerInfo;
  track: TrackInfo;
}
