export type BlockedSong = {
  artist: string;
  title: string;
};

export type SkipAiMusicPluginConfig = {
  enabled: boolean;
  /**
   * Sync and skip artists from the Soul Over AI community list.
   */
  useCommunityList: boolean;
  /**
   * Dislike a matched track before skipping it.
   */
  dislikeOnSkip: boolean;
  /**
   * Show block-artist / block-song buttons on the player bar.
   */
  showPlayerButtons: boolean;
  /**
   * Also skip titles that look like mass-produced AI or "slop" variants.
   */
  skipCommonKeywords: boolean;
  blockedArtists: string[];
  allowedArtists: string[];
  blockedKeywords: string[];
  blockedSongs: BlockedSong[];
};

export const COMMON_AI_KEYWORDS = [
  'ai cover',
  'ai generated',
  'ai remix',
  'ai version',
  'nightcore',
  'sped up',
  'suno',
  'udio',
];

export const defaultConfig: SkipAiMusicPluginConfig = {
  enabled: false,
  useCommunityList: true,
  dislikeOnSkip: false,
  showPlayerButtons: true,
  skipCommonKeywords: false,
  blockedArtists: [],
  allowedArtists: [],
  blockedKeywords: [],
  blockedSongs: [],
};

export const COMMUNITY_ARTISTS_URL =
  'https://raw.githubusercontent.com/xoundbyte/soul-over-ai/main/dist/artists.json';

export const COMMUNITY_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
