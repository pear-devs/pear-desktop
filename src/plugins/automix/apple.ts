import { app, net } from 'electron';

import type { AppleAnalysis, AppleLookup, VocalStrength } from './constants';

/**
 * Apple Music's per-song analysis (the beat grid, bars, phrase / section
 * marks and vocal activity its own AutoMix plans with), looked up by title,
 * artist and duration in Apple's public catalog API with the token the
 * music.apple.com web player ships. Unofficial: anything failing just means
 * AutoMix falls back to its own analysis.
 */

const API = 'https://amp-api.music.apple.com/v1/catalog';
const WEB = 'https://music.apple.com';
/** Apple's own rule for trusting a song's timing: durations within 2 s */
const MAX_DURATION_DELTA = 2;
/** Don't ask again for a song Apple has no match for */
const MISS_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_CACHED = 200;
/** Longest one request may take, body included: the analysis is optional */
const REQUEST_TIMEOUT_MS = 10_000;

interface Token {
  value: string;
  /** Seconds since the epoch */
  expires: number;
}

let token: Promise<Token> | null = null;
const cache = new Map<string, { at: number; value: AppleAnalysis | null }>();
const pending = new Map<string, Promise<AppleAnalysis | null>>();

const headers = (value: string) => ({
  Authorization: `Bearer ${value}`,
  Origin: WEB,
});

const fetchWithin = (url: string, init: RequestInit = {}) =>
  net.fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });

/** The developer token embedded in the web player's main script */
const scrapeToken = async (): Promise<Token> => {
  const page = await (await fetchWithin(`${WEB}/us/browse`)).text();
  const script = /\/assets\/index[^"']*\.js/.exec(page)?.[0];
  if (!script) throw new Error('Apple Music web player script not found');
  const source = await (await fetchWithin(`${WEB}${script}`)).text();
  const value = /eyJ[\w-]{10,}\.[\w-]+\.[\w-]+/.exec(source)?.[0];
  if (!value) throw new Error('Apple Music web player token not found');
  const payload = JSON.parse(
    Buffer.from(value.split('.')[1], 'base64url').toString(),
  ) as { exp?: number };
  return { value, expires: payload.exp ?? ((Date.now() / 1000) + 86_400) };
};

const getToken = async (refresh = false) => {
  if (token && !refresh) {
    const current = await token.catch(() => null);
    if (current && current.expires - 3600 > Date.now() / 1000) return current;
  }
  token = scrapeToken();
  token.catch(() => {
    token = null;
  });
  return token;
};

const request = async <T>(path: string): Promise<T> => {
  let auth = await getToken();
  let response = await fetchWithin(`${API}${path}`, {
    headers: headers(auth.value),
  });
  if (response.status === 401 || response.status === 403) {
    auth = await getToken(true);
    response = await fetchWithin(`${API}${path}`, {
      headers: headers(auth.value),
    });
  }
  if (!response.ok) throw new Error(`Apple Music API ${response.status}`);
  return (await response.json()) as T;
};

const storefront = () => (app.getLocaleCountryCode() || 'us').toLowerCase();

/** Lowercase words, without the bits YouTube titles add ("Official Video") */
const words = (text: string) =>
  text
    .toLowerCase()
    .replaceAll(/\((?:official|lyric|audio|video|visuali[sz]er)[^)]*\)/g, ' ')
    .replaceAll(/\[[^\]]*\]/g, ' ')
    .replaceAll(/\b(?:feat|ft)\.?\b.*$/g, ' ')
    .normalize('NFKD')
    .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

/** Share of `a`'s words that appear in `b` */
const overlap = (a: string[], b: string[]) =>
  a.length === 0 ? 0 : a.filter((word) => b.includes(word)).length / a.length;

interface SearchSong {
  id: string;
  attributes: { name: string; artistName: string; durationInMillis: number };
}

const findSong = async (lookup: AppleLookup, front: string) => {
  const term = [...words(lookup.title), ...words(lookup.artist)]
    .slice(0, 12)
    .join(' ');
  if (!term) return null;
  const result = await request<{
    results: { songs?: { data: SearchSong[] } };
  }>(`/${front}/search?types=songs&limit=10&term=${encodeURIComponent(term)}`);

  const title = words(lookup.title);
  const artist = words(lookup.artist);
  let best: { id: string; score: number } | null = null;
  for (const song of result.results.songs?.data ?? []) {
    const { name, artistName, durationInMillis } = song.attributes;
    if (
      Math.abs((durationInMillis / 1000) - lookup.duration) > MAX_DURATION_DELTA
    ) {
      continue;
    }
    const nameWords = words(name);
    const titleScore = Math.min(
      overlap(nameWords, title),
      overlap(title, [...nameWords, ...words(artistName)]),
    );
    const artistScore =
      artist.length === 0 ? 0.5 : overlap(artist, words(artistName));
    const score = titleScore + (0.5 * artistScore);
    if (titleScore >= 0.6 && (!best || score > best.score)) {
      best = { id: song.id, score };
    }
  }
  return best?.id ?? null;
};

interface Rel<T> {
  data?: { attributes?: T }[];
}

interface AudioAttributes {
  bpm?: { main?: number; beginning?: number; ending?: number };
  key?: Record<string, { tonic: string; mode: string } | undefined>;
  beats?: { beatsInMilliseconds?: number[]; barsInMilliseconds?: number[] };
  vocalActivity?: {
    startInMilliseconds: number;
    endInMilliseconds: number;
    strength: VocalStrength;
  }[];
  loudnessCurve?: { value?: number[] };
  fades?: {
    fadeOut?: { startInMilliseconds: number; endInMilliseconds: number };
  };
  danceability?: { main?: number };
  acousticness?: { main?: number };
  melodicness?: { main?: number };
}

interface FlexAttributes {
  videoEvents?: { timeInSeconds?: number[]; score?: number[] };
  entryPoints?: { timeInSeconds: number; tags?: string[] }[];
}

export interface CatalogSong {
  id: string;
  attributes: {
    durationInMillis: number;
    supportsSmartTransitions?: boolean;
    genreNames?: string[];
  };
  relationships?: {
    'audio-analysis'?: Rel<AudioAttributes>;
    'flexml-analysis'?: Rel<FlexAttributes>;
  };
}

/** The parts of a catalog song's analysis AutoMix uses, in seconds */
export const toAppleAnalysis = (song: CatalogSong): AppleAnalysis | null => {
  const audio = song.relationships?.['audio-analysis']?.data?.[0]?.attributes;
  const flex = song.relationships?.['flexml-analysis']?.data?.[0]?.attributes;
  const beats = audio?.beats?.beatsInMilliseconds;
  // Apple doesn't AutoMix songs it marks as unsuitable, and neither do we
  if (song.attributes.supportsSmartTransitions === false) return null;
  if (!audio || !beats?.length) return null;

  const times = flex?.videoEvents?.timeInSeconds ?? [];
  const scores = flex?.videoEvents?.score ?? [];
  const bpm = audio.bpm?.main ?? 0;
  return {
    id: song.id,
    duration: song.attributes.durationInMillis / 1000,
    bpm: {
      main: bpm,
      beginning: audio.bpm?.beginning ?? bpm,
      ending: audio.bpm?.ending ?? bpm,
    },
    key: { beginning: audio.key?.beginning, ending: audio.key?.ending },
    beats: beats.map((ms) => ms / 1000),
    bars: (audio.beats?.barsInMilliseconds ?? []).map((ms) => ms / 1000),
    events: times.map((time, i) => ({ time, score: scores[i] ?? 0 })),
    vocals: (audio.vocalActivity ?? []).map((region) => ({
      start: region.startInMilliseconds / 1000,
      end: region.endInMilliseconds / 1000,
      strength: region.strength,
    })),
    loudness: audio.loudnessCurve?.value ?? [],
    fadeOut: audio.fades?.fadeOut && {
      start: audio.fades.fadeOut.startInMilliseconds / 1000,
      end: audio.fades.fadeOut.endInMilliseconds / 1000,
    },
    salient: (flex?.entryPoints ?? [])
      .filter((point) => point.tags?.includes('salient'))
      .map((point) => point.timeInSeconds),
    traits: {
      danceability: audio.danceability?.main,
      acousticness: audio.acousticness?.main,
      melodicness: audio.melodicness?.main,
    },
    genres: song.attributes.genreNames ?? [],
  };
};

const fetchAnalysis = async (id: string, front: string) => {
  const result = await request<{ data: CatalogSong[] }>(
    `/${front}/songs/${id}?include=audio-analysis,flexml-analysis` +
      '&extend=supportsSmartTransitions&extend[audio-analysis]=fades,loudnessCurve',
  );
  return result.data[0] ? toAppleAnalysis(result.data[0]) : null;
};

const lookUp = async (lookup: AppleLookup) => {
  const front = storefront();
  const id =
    (await findSong(lookup, front)) ??
    (front === 'us' ? null : await findSong(lookup, 'us'));
  if (!id) return null;
  return fetchAnalysis(id, front).catch(() => fetchAnalysis(id, 'us'));
};

export const appleAnalysis = async (
  lookup: AppleLookup,
): Promise<AppleAnalysis | null> => {
  const key = `${lookup.title}\n${lookup.artist}\n${Math.round(lookup.duration)}`;
  const cached = cache.get(key);
  if (cached && (cached.value || Date.now() - cached.at < MISS_TTL_MS)) {
    return cached.value;
  }
  const running = pending.get(key);
  if (running) return running;

  const promise = lookUp(lookup)
    .then((value) => {
      // Only a finished lookup is remembered; a network error is retried
      cache.delete(key);
      cache.set(key, { at: Date.now(), value });
      if (cache.size > MAX_CACHED) {
        cache.delete(cache.keys().next().value as string);
      }
      return value;
    })
    .catch((error: unknown) => {
      console.warn('[AutoMix] Apple Music analysis failed', error);
      return null;
    })
    .finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
};
