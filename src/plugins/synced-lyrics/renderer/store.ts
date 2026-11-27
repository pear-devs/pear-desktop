import { batch, createEffect, createMemo, runWithOwner } from 'solid-js';
import { createStore } from 'solid-js/store';
import { detect } from 'tinyld';

import { reactiveOwner } from './reactive-root';
import { activeTrack, isCurrentTrack } from './track';

import {
  type ProviderName,
  providerNames,
  type ProviderState,
} from '../providers';
import { providers } from '../providers/renderer';

import type { LyricProvider, LyricResult } from '../types';
import type { SongInfo } from '@/providers/song-info';

type LyricsStore = {
  videoId: string;
  generation: number;
  provider: ProviderName;
  current: ProviderState;
  lyrics: Record<ProviderName, ProviderState>;
};

const initialData = () =>
  providerNames.reduce(
    (acc, name) => {
      acc[name] = { state: 'fetching', data: null, error: null };
      return acc;
    },
    {} as LyricsStore['lyrics'],
  );

export const [lyricsStore, setLyricsStore] = createStore<LyricsStore>({
  videoId: '',
  generation: 0,
  provider: providerNames[0],
  lyrics: initialData(),
  get current(): ProviderState {
    return this.lyrics[this.provider];
  },
});

export const currentLyrics = runWithOwner(reactiveOwner, () => {
  const current = createMemo(() => {
    const provider = lyricsStore.provider;
    return lyricsStore.lyrics[provider];
  });
  return current;
})!;
/**
 * Returns the best available provider result that has a detected language,
 * without requiring lyricsStore.provider to have been set by LyricsPicker.
 * Prefers the currently selected provider, then falls back to any done provider
 * with a language so that auto-skip works even when the lyrics panel is hidden.
 */
export const bestLanguageResult = runWithOwner(reactiveOwner, () => {
  const best = createMemo(() => {
    const track = activeTrack();
    if (
      lyricsStore.videoId !== track.videoId ||
      lyricsStore.generation !== track.generation
    )
      return null;
    const current = lyricsStore.lyrics[lyricsStore.provider];
    if (current.state === 'done' && current.data?.language) return current;

    for (const name of providerNames) {
      const state = lyricsStore.lyrics[name];
      if (state.state === 'done' && state.data?.language) return state;
    }

    return null;
  });
  return best;
})!;

type VideoId = string;

type SearchCacheData = Record<ProviderName, ProviderState>;
interface SearchCache {
  videoId: string;
  data: SearchCacheData;
}

// TODO: Maybe use localStorage for the cache.
const searchCache = new Map<VideoId, SearchCache>();
let activeCache: SearchCache | undefined;

runWithOwner(reactiveOwner, () =>
  createEffect(() => {
    const track = activeTrack();
    if (lyricsStore.generation === track.generation) return;
    activeCache = undefined;
    setLyricsStore({
      videoId: track.videoId,
      generation: track.generation,
      lyrics: initialData(),
    });
  }),
);

const publish = (cache: SearchCache) => {
  const track = activeTrack();
  if (
    activeCache !== cache ||
    cache.videoId !== track.videoId ||
    !isCurrentTrack(track)
  )
    return;
  batch(() => {
    setLyricsStore('videoId', track.videoId);
    setLyricsStore('generation', track.generation);
    for (const name of providerNames) {
      const state = cache.data[name];
      setLyricsStore('lyrics', name, {
        ...state,
        data: state.data ? { ...state.data } : null,
      });
    }
  });
};

/**
 * Detects the language of lyrics and adds it to the result.
 * Handles edge cases: no lyrics, empty text, detection failure.
 */
const detectLyricsLanguage = (
  result: LyricResult | null,
): LyricResult | null => {
  if (!result) return null;

  try {
    // Extract text from either plain lyrics or synced lines
    let textToAnalyze = '';
    const plainLyrics = result.lyrics?.trim();

    if (plainLyrics) {
      textToAnalyze = plainLyrics;
    } else if (result.lines && result.lines.length > 0) {
      textToAnalyze = result.lines
        .map((line) => line.text)
        .join('\n')
        .trim();
    }

    // Only attempt detection if we have meaningful text
    if (textToAnalyze.length > 0) {
      const detectedLang = detect(textToAnalyze);
      // Only set language if detection was successful (not empty string)
      if (detectedLang) {
        return { ...result, language: detectedLang };
      }
    }
  } catch (error) {
    // Detection failed - log but don't throw, just leave language undefined
    console.warn('Language detection failed:', error);
  }

  return result;
};
export const fetchLyrics = (info: SongInfo) => {
  const track = activeTrack();
  if (info.videoId !== track.videoId || !isCurrentTrack(track)) return;
  const existing = searchCache.get(info.videoId);
  const cache: SearchCache = existing ?? {
    videoId: info.videoId,
    data: initialData(),
  };
  activeCache = cache;
  publish(cache);
  if (existing) return;
  searchCache.set(info.videoId, cache);

  // prettier-ignore
  for (
    const [providerName, provider] of Object.entries(providers) as [
    ProviderName,
    LyricProvider,
  ][]
    ) {
    const pCache = cache.data[providerName];

    Promise.resolve()
        .then(() => provider.search(info))
        .then((res) => {
          if (cache.data[providerName] !== pCache) return;
          // Detect language from the lyrics result
          const resultWithLanguage = detectLyricsLanguage(res);

          pCache.state = 'done';
          pCache.data = resultWithLanguage;

          publish(cache);
        })
        .catch((error: Error) => {
          if (cache.data[providerName] !== pCache) return;
          pCache.state = 'error';
          pCache.error = error;

          console.error(error);

          publish(cache);
        });
  }
};

export const retrySearch = (provider: ProviderName, info: SongInfo) => {
  const track = activeTrack();
  const cache = activeCache;
  if (!cache || info.videoId !== track.videoId || !isCurrentTrack(track))
    return;
  const pCache: ProviderState = {
    state: 'fetching',
    data: null,
    error: null,
  };
  cache.data[provider] = pCache;
  publish(cache);
  Promise.resolve()
    .then(() => providers[provider].search(info))
    .then((res) => {
      if (cache.data[provider] !== pCache) return;
      // Detect language from the lyrics result
      const resultWithLanguage = detectLyricsLanguage(res);

      cache.data[provider] = {
        state: 'done',
        data: resultWithLanguage,
        error: null,
      };
      publish(cache);
    })
    .catch((error: Error) => {
      if (cache.data[provider] !== pCache) return;
      cache.data[provider] = { state: 'error', data: null, error };
      publish(cache);
    });
};
