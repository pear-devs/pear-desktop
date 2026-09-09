import { COMMON_AI_KEYWORDS, type SkipAiMusicPluginConfig } from './types';

export type SkipMatchInput = {
  artist: string;
  title: string;
};

export type SkipMatchReason =
  | 'allowed-artist'
  | 'blocked-artist'
  | 'blocked-song'
  | 'community-artist'
  | 'keyword';

export type SkipMatchResult = {
  matched?: string;
  reason?: SkipMatchReason;
  skip: boolean;
};

const ARTIST_SPLIT_RE =
  /\s*(?:,|&|\/| x | feat\.? | ft\.? | featuring | vs\.? | versus )\s*/iu;

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const normalizeName = (value: string) =>
  value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

export const foldName = (value: string) =>
  normalizeName(value)
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const splitArtists = (artist: string): string[] => {
  const normalized = normalizeName(artist);
  if (!normalized) {
    return [];
  }

  const withoutMeta = normalized.split('•')[0]?.trim() || normalized;
  const tokens = withoutMeta
    .split(ARTIST_SPLIT_RE)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  return [...new Set([withoutMeta, ...tokens])];
};

export const hasWholePhrase = (haystack: string, needle: string) => {
  const phrase = normalizeName(needle);
  if (!phrase) {
    return false;
  }

  const source = normalizeName(haystack);
  const regex = new RegExp(
    `(^|[^\\p{L}\\p{N}_])${escapeRegExp(phrase)}($|[^\\p{L}\\p{N}_])`,
    'iu',
  );
  return regex.test(source);
};

const toArtistSet = (artists: string[]) => {
  const folded = new Set<string>();
  for (const artist of artists) {
    const value = foldName(artist);
    if (value) {
      folded.add(value);
    }
  }
  return folded;
};

export const buildCommunityArtistSet = (artists: string[]) =>
  toArtistSet(artists);

const songKey = (title: string, artist: string) =>
  `${foldName(title)}\u0000${foldName(artist)}`;

export const shouldSkipTrack = (
  input: SkipMatchInput,
  config: SkipAiMusicPluginConfig,
  communityArtists: Set<string> | string[] = [],
): SkipMatchResult => {
  const title = input.title || '';
  const artist = input.artist || '';
  if (!title && !artist) {
    return { skip: false };
  }

  const artistTokens = splitArtists(artist);
  const foldedTokens = artistTokens.map((token) => foldName(token));
  const allowed = toArtistSet(config.allowedArtists);

  for (const token of foldedTokens) {
    if (token && allowed.has(token)) {
      return { matched: token, reason: 'allowed-artist', skip: false };
    }
  }

  const blockedSongs = config.blockedSongs || [];
  const titleFolded = foldName(title);
  const titleKeys = new Set(
    foldedTokens.map((token) => songKey(title, token)),
  );
  titleKeys.add(songKey(title, artist));
  for (const song of blockedSongs) {
    if (!song || !song.title) {
      continue;
    }

    if (song.artist && titleKeys.has(songKey(song.title, song.artist))) {
      return {
        matched: `${song.artist} - ${song.title}`,
        reason: 'blocked-song',
        skip: true,
      };
    }

    // Entries stored without an artist match on title alone.
    if (!song.artist && foldName(song.title) == titleFolded) {
      return {
        matched: song.title,
        reason: 'blocked-song',
        skip: true,
      };
    }
  }

  const customArtists = toArtistSet(config.blockedArtists);
  for (let i = 0; i < foldedTokens.length; i++) {
    const token = foldedTokens[i];
    if (token && customArtists.has(token)) {
      return {
        matched: artistTokens[i],
        reason: 'blocked-artist',
        skip: true,
      };
    }
  }

  if (config.useCommunityList) {
    const community =
      communityArtists instanceof Set
        ? communityArtists
        : toArtistSet(communityArtists);
    for (let i = 0; i < foldedTokens.length; i++) {
      const token = foldedTokens[i];
      if (token && community.has(token)) {
        return {
          matched: artistTokens[i],
          reason: 'community-artist',
          skip: true,
        };
      }
    }
  }

  const keywords = [
    ...(config.blockedKeywords || []),
    ...(config.skipCommonKeywords ? COMMON_AI_KEYWORDS : []),
  ];
  for (const keyword of keywords) {
    if (hasWholePhrase(title, keyword) || hasWholePhrase(artist, keyword)) {
      return { matched: keyword, reason: 'keyword', skip: true };
    }
  }

  return { skip: false };
};

export const uniqueNormalized = (values: string[]) => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) {
      continue;
    }

    const key = foldName(normalized);
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalized);
  }

  return result;
};
