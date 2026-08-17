export type BlockedSong = {
  artist: string;
  title: string;
};

export type SkipAiMusicPluginConfig = {
  allowedArtists: string[];
  blockedArtists: string[];
  blockedKeywords: string[];
  blockedSongs: BlockedSong[];
  dislikeOnSkip: boolean;
  enabled: boolean;
  skipCommonKeywords: boolean;
  useCommunityList: boolean;
  communityMinScore: number;
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
  allowedArtists: [],
  blockedArtists: [],
  blockedKeywords: [],
  blockedSongs: [],
  dislikeOnSkip: false,
  enabled: false,
  skipCommonKeywords: false,
  useCommunityList: true,
  communityMinScore: 90,
};

export const COMMUNITY_ARTISTS_URL = 'https://zoundhub.com/api/artists/all';

export const DEFAULT_COMMUNITY_MIN_SCORE = 90;

export const COMMUNITY_CACHE_VERSION = 3;

export const clampCommunityMinScore = (value: unknown): number => {
  const score = Math.round(Number(value));
  if (!Number.isFinite(score)) {
    return DEFAULT_COMMUNITY_MIN_SCORE;
  }
  if (score < 0) {
    return 0;
  }
  if (score > 100) {
    return 100;
  }
  return score;
};

export const COMMUNITY_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
