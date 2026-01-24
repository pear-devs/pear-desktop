import { createStore } from 'solid-js/store';
import { createMemo } from 'solid-js';

import { getSongInfo } from '@/providers/song-info-front';

import {
  type ProviderName,
  providerNames,
  type ProviderState,
  ProviderNames,
} from '../providers';
import { providers } from '../providers/renderer';

import type { LyricProvider } from '../types';
import type { SongInfo } from '@/providers/song-info';
import type { LyricsStore } from '@/plugins/lyrics-provider/types';

let config: { preferredProvider: string | null } | null = null;

export const setConfig = (newConfig: typeof config) => {
  config = newConfig;
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

export const currentLyrics = createMemo(() => {
  const provider = lyricsStore.provider;
  return lyricsStore.lyrics[provider];
});

let netFetch: (
  url: string,
  init?: RequestInit,
) => Promise<[number, string, Record<string, string>]>;

export const setNetFetch = (fetchFn: typeof netFetch) => {
  netFetch = fetchFn;
};

type VideoId = string;

type SearchCacheData = Record<ProviderName, ProviderState>;
interface SearchCache {
  state: 'loading' | 'done';
  data: SearchCacheData;
}

// TODO: Maybe use localStorage for the cache.
const searchCache = new Map<VideoId, SearchCache>();
export const fetchLyrics = (info: SongInfo) => {
  if (!netFetch) {
    console.warn('netFetch not set for lyrics provider');
    return;
  }

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
        return JSON.parse(JSON.stringify(cache.data)) as typeof cache.data;
      });
      // Pick the best provider
      const bestProvider = pickBestProvider();
      setLyricsStore('provider', bestProvider);
    }

    return;
  }

  const cache: SearchCache = {
    state: 'loading',
    data: initialData(),
  };

  searchCache.set(info.videoId, cache);
  if (getSongInfo().videoId === info.videoId) {
    setLyricsStore('lyrics', () => {
      // weird bug with solid-js
      return JSON.parse(JSON.stringify(cache.data)) as typeof cache.data;
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

    tasks.push(
      provider
        .search(info)
        .then((res) => {
          pCache.state = 'done';
          pCache.data = res;

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

    // Pick the best provider
    const bestProvider = pickBestProvider();
    setLyricsStore('provider', bestProvider);
  });
};

export const retrySearch = (provider: ProviderName, info: SongInfo) => {
  setLyricsStore('lyrics', (old) => {
    const pCache = {
      state: 'fetching',
      data: null,
      error: null,
    };

    return {
      ...old,
      [provider]: pCache,
    };
  });

  providers[provider]
    .search(info)
    .then((res) => {
      setLyricsStore('lyrics', (old) => {
        return {
          ...old,
          [provider]: { state: 'done', data: res, error: null },
        };
      });
    })
    .catch((error) => {
      setLyricsStore('lyrics', (old) => {
        return {
          ...old,
          [provider]: { state: 'error', data: null, error },
        };
      });
    });
};

const providerBias = (p: ProviderName) =>
  (lyricsStore.lyrics[p].state === 'done' ? 1 : -1) +
  (lyricsStore.lyrics[p].data?.lines?.length ? 2 : -1) +
  // eslint-disable-next-line prettier/prettier
  (lyricsStore.lyrics[p].data?.lines?.length && p === ProviderNames.YTMusic
    ? 1
    : 0) +
  (lyricsStore.lyrics[p].data?.lyrics ? 1 : -1);

const pickBestProvider = () => {
  const preferred = config?.preferredProvider as ProviderName | undefined;
  if (preferred) {
    const data = lyricsStore.lyrics[preferred].data;
    if (Array.isArray(data?.lines) || data?.lyrics) {
      return preferred;
    }
  }

  const providers = Array.from(providerNames);
  providers.sort((a, b) => providerBias(b) - providerBias(a));

  return providers[0];
};
