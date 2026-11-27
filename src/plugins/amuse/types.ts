export interface PlayerInfo {
  hasSong: boolean;
  isPaused: boolean;
  volumePercent: number;
  seekbarCurrentPosition: number;
  seekbarCurrentPositionHuman: string;
  statePercent: number;
  likeStatus: string;
  repeatType: string;
}

export interface TrackInfo {
  author: string;
  title: string;
  album: string;
  cover: string;
  duration: number;
  durationHuman: string;
  url: string;
  id: string;
  isVideo: boolean;
  isAdvertisement: boolean;
  inLibrary: boolean;
}

export interface AmuseSongInfo {
  player: PlayerInfo;
  track: TrackInfo;
}
