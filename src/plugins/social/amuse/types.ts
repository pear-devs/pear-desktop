export interface PlayerInfo {
  hasSong: boolean;
  isPaused: boolean;
  seekbarCurrentPosition: number;
}

export interface TrackInfo {
  author: string;
  title: string;
  cover: string;
  duration: number;
  url: string;
  id: string;
  isAdvertisement: boolean;
}

export interface AmuseSongInfo {
  player: PlayerInfo;
  track: TrackInfo;
}
