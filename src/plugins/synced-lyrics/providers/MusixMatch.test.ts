import { test, expect } from '@playwright/test';

import { MusixMatch } from './MusixMatch';

import { configureElectronTransport } from '../search/electron-transport';

const info = {
  title: 'Song',
  artist: 'Artist',
  songDuration: 10,
  videoId: 'test',
};

test('MusixMatch embedded 401 refresh is bounded; corrupt saved token recovers locally', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'localStorage',
  );
  const values = new Map([['ytm:synced-lyrics:mxm:token', '{bad json']]);
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  const urls: string[] = [];
  configureElectronTransport((_, _id, url) => {
    urls.push(String(url));
    const message = String(url).includes('token.get')
      ? { body: { user_token: 'token' } }
      : { header: { status_code: 401 } };
    return Promise.resolve({
      status: 200,
      headers: {},
      body: JSON.stringify({ message }),
    });
  });
  try {
    await expect(new MusixMatch().search(info)).rejects.toMatchObject({
      kind: 'auth',
    });
    expect(urls).toHaveLength(4);
    expect(urls.filter((url) => url.includes('token.get'))).toHaveLength(2);
  } finally {
    configureElectronTransport(undefined);
    if (descriptor)
      Object.defineProperty(globalThis, 'localStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('MusixMatch retains subtitle variants and source identity/metadata, without hardcoded wrong-song IDs', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'localStorage',
  );
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () =>
        JSON.stringify({ token: 'token', expires: Date.now() + 60000 }),
      setItem() {},
      removeItem() {},
    },
  });
  configureElectronTransport(() =>
    Promise.resolve({
      status: 200,
      headers: {},
      body: JSON.stringify({
        message: {
          body: {
            macro_calls: {
              'matcher.track.get': {
                message: {
                  body: {
                    track: {
                      track_id: 115264642,
                      track_name: 'Song',
                      artist_name: 'Artist',
                      album_name: 'Album',
                      track_length: 10,
                    },
                  },
                },
              },
              'track.lyrics.get': {
                message: { body: { lyrics: { lyrics_body: 'Exact plain' } } },
              },
              'track.subtitles.get': {
                message: {
                  body: {
                    subtitle_list: [
                      {
                        subtitle: {
                          subtitle_id: 1,
                          subtitle_language: 'en',
                          subtitle_body: '[00:00] Hello! ',
                        },
                      },
                      {
                        subtitle: {
                          subtitle_id: 2,
                          subtitle_language: 'ja',
                          subtitle_body: '[00:00] 世界 ',
                        },
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      }),
    }),
  );
  try {
    const candidates = await new MusixMatch().search(info);
    expect(candidates.map((item) => item.id)).toEqual([
      '115264642:1',
      '115264642:2',
    ]);
    expect(candidates[0]).toMatchObject({
      sourceId: '115264642',
      album: 'Album',
      durationMs: 10000,
      language: 'en',
    });
    expect(candidates[1].result.lines![0].text).toBe(' 世界 ');
  } finally {
    configureElectronTransport(undefined);
    if (descriptor)
      Object.defineProperty(globalThis, 'localStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
