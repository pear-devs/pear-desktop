import { createMemo, runWithOwner } from 'solid-js';
import { createStore } from 'solid-js/store';

import { getSongInfo } from '@/providers/song-info-front';

import { reactiveOwner } from './reactive-root';

import {
  type ProviderName,
  providerNames,
  type ProviderState,
} from '../providers';
import { providers } from '../providers/renderer';

import type { LyricProvider } from '../types';
import type { SongInfo } from '@/providers/song-info';

type LyricsStore = {
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
  provider: providerNames[0],
  lyrics: initialData(),
  get current(): ProviderState {
    return this.lyrics[this.provider];
  },
});

export const currentLyrics = runWithOwner(reactiveOwner, () =>
  createMemo(() => {
    const provider = lyricsStore.provider;
    return lyricsStore.lyrics[provider];
  }),
)!;

type VideoId = string;

type SearchCacheData = Record<ProviderName, ProviderState>;
interface SearchCache {
  state: 'loading' | 'done';
  data: SearchCacheData;
}

type PersistentCacheEntry = {
  cachedAt: number;
  lyrics: Partial<Record<ProviderName, NonNullable<ProviderState['data']>>>;
};

type PersistentCache = Record<VideoId, PersistentCacheEntry>;

// New domain schema: old entries contain timeInMs/status and serialized Infinity.
const persistentCacheKey = 'ytmd-sl-cache-v2';
const persistentCacheLifetime = 30 * 24 * 60 * 60 * 1000;
const persistentCacheLimit = 50;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const loadPersistentCache = (): PersistentCache => {
  try {
    const stored: unknown = JSON.parse(
      localStorage.getItem(persistentCacheKey) ?? '{}',
    );
    if (!stored || typeof stored !== 'object' || Array.isArray(stored))
      return {};

    const now = Date.now();
    return Object.fromEntries(
      Object.entries(stored).filter(([, entry]) => {
        const candidate = entry as { cachedAt?: unknown };
        return (
          entry &&
          typeof entry === 'object' &&
          typeof candidate.cachedAt === 'number' &&
          now - candidate.cachedAt < persistentCacheLifetime
        );
      }),
    ) as PersistentCache;
  } catch {
    localStorage.removeItem(persistentCacheKey);
    return {};
  }
};

let persistentCache = loadPersistentCache();

const savePersistentCache = () => {
  try {
    localStorage.setItem(persistentCacheKey, JSON.stringify(persistentCache));
  } catch {
    const oldest = Object.entries(persistentCache).sort(
      ([, a], [, b]) => a.cachedAt - b.cachedAt,
    )[0]?.[0];
    if (!oldest) return;

    delete persistentCache[oldest];
    try {
      localStorage.setItem(persistentCacheKey, JSON.stringify(persistentCache));
    } catch {}
  }
};

const cachePersistentLyrics = (
  videoId: VideoId,
  provider: ProviderName,
  lyrics: NonNullable<ProviderState['data']>,
) => {
  const entry = persistentCache[videoId] ?? {
    cachedAt: Date.now(),
    lyrics: {},
  };
  entry.cachedAt = Date.now();
  entry.lyrics[provider] = clone(lyrics);
  persistentCache[videoId] = entry;

  const excessEntries = Object.entries(persistentCache)
    .sort(([, a], [, b]) => b.cachedAt - a.cachedAt)
    .slice(persistentCacheLimit);
  for (const [id] of excessEntries) delete persistentCache[id];

  savePersistentCache();
};

const searchCache = new Map<VideoId, SearchCache>();
export const fetchLyrics = (info: SongInfo) => {
  if (searchCache.has(info.videoId)) {
    const cache = searchCache.get(info.videoId)!;

    if (cache.state === 'loading') {
      setTimeout(() => {
        fetchLyrics(info);
      });
      return;
    }

    if (getSongInfo().videoId === info.videoId) {
      setLyricsStore('lyrics', () => {
        // weird bug with solid-js
        return clone(cache.data);
      });
    }

    return;
  }

  const data = initialData();
  const cachedLyrics = persistentCache[info.videoId]?.lyrics;
  if (cachedLyrics) {
    for (const [provider, lyrics] of Object.entries(cachedLyrics) as [
      ProviderName,
      NonNullable<ProviderState['data']>,
    ][]) {
      data[provider] = { state: 'done', data: clone(lyrics), error: null };
    }
  }

  const cache: SearchCache = {
    state: 'loading',
    data,
  };

  searchCache.set(info.videoId, cache);
  if (getSongInfo().videoId === info.videoId) {
    setLyricsStore('lyrics', () => {
      // weird bug with solid-js
      return clone(cache.data);
    });
  }

  const tasks: Promise<void>[] = [];

  // prettier-ignore
  for (
    const [providerName, provider] of Object.entries(providers) as [
    ProviderName,
    LyricProvider,
  ][]
    ) {
    const pCache = cache.data[providerName];
    if (pCache.state === 'done') continue;

    tasks.push(
      provider
        .search(info)
        .then((res) => {
          pCache.state = 'done';
          pCache.data = res;
          if (res) cachePersistentLyrics(info.videoId, providerName, res);

          if (getSongInfo().videoId === info.videoId) {
            setLyricsStore('lyrics', (old) => {
              return {
                ...old,
                [providerName]: {
                  state: 'done',
                  data: res ? { ...res } : null,
                  error: null,
                },
              };
            });
          }
        })
        .catch((error: Error) => {
          pCache.state = 'error';
          pCache.error = error;

          console.error(error);

          if (getSongInfo().videoId === info.videoId) {
            setLyricsStore('lyrics', (old) => {
              return {
                ...old,
                [providerName]: { state: 'error', error, data: null },
              };
            });
          }
        }),
    );
  }

  Promise.allSettled(tasks).then(() => {
    cache.state = 'done';
    searchCache.set(info.videoId, cache);
  });
};

export const retrySearch = (provider: ProviderName, info: SongInfo) => {
  const update = (state: ProviderState) => {
    const cache = searchCache.get(info.videoId);
    if (cache) cache.data[provider] = state;

    if (getSongInfo().videoId === info.videoId) {
      setLyricsStore('lyrics', (old) => ({
        ...old,
        [provider]: state,
      }));
    }
  };

  update({ state: 'fetching', data: null, error: null });

  providers[provider]
    .search(info)
    .then((res) => {
      update({ state: 'done', data: res, error: null });
      if (res) cachePersistentLyrics(info.videoId, provider, res);
    })
    .catch((error) => {
      update({
        state: 'error',
        data: null,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    });
};
