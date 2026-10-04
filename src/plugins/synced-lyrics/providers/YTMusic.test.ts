import { test, expect } from '@playwright/test';

import { YTMusic } from './YTMusic';

import type { SearchSongInfo } from '../types';

const info: SearchSongInfo = {
  title: 'Song',
  artist: 'Artist',
  videoId: 'test',
  songDuration: 10,
};

const searchFixture = async (contents: unknown) => {
  const documentDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'document',
  );
  const originalFetch = globalThis.fetch;
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      querySelector: () => ({
        networkManager: {
          fetch: () =>
            Promise.resolve({
              contents: {
                singleColumnMusicWatchNextResultsRenderer: {
                  tabbedRenderer: {
                    watchNextTabbedResultsRenderer: {
                      tabs: [
                        {
                          tabRenderer: {
                            endpoint: {
                              browseEndpoint: {
                                browseId: 'lyrics',
                                browseEndpointContextSupportedConfigs: {
                                  browseEndpointContextMusicConfig: {
                                    pageType: 'MUSIC_PAGE_TYPE_TRACK_LYRICS',
                                  },
                                },
                              },
                            },
                          },
                        },
                      ],
                    },
                  },
                },
              },
            }),
        },
      }),
    },
  });
  globalThis.fetch = () =>
    Promise.resolve(new Response(JSON.stringify({ contents })));
  try {
    return await new YTMusic().search(info);
  } finally {
    globalThis.fetch = originalFetch;
    if (documentDescriptor)
      Object.defineProperty(globalThis, 'document', documentDescriptor);
    else Reflect.deleteProperty(globalThis, 'document');
  }
};

const timedContents = (lines: unknown[]) => ({
  elementRenderer: {
    newElement: {
      type: {
        componentType: {
          model: {
            timedLyricsModel: { lyricsData: { timedLyricsData: lines } },
          },
        },
      },
    },
  },
});

test('YTMusic preserves explicit line ends and whitespace; intro has actual interval', async () => {
  const result = await searchFixture(
    timedContents([
      {
        lyricLine: '  Hello 世界!  ',
        cueRange: {
          startTimeMilliseconds: '1000',
          endTimeMilliseconds: '2000',
        },
      },
      {
        lyricLine: 'Last',
        cueRange: {
          startTimeMilliseconds: '4000',
          endTimeMilliseconds: '6000',
        },
      },
    ]),
  );
  expect(result).toEqual({
    title: 'Song',
    artists: ['Artist'],
    syncLevel: 'line',
    lyrics: undefined,
    lines: [
      { text: '', startMs: 0, endMs: 1000 },
      { text: '  Hello 世界!  ', startMs: 1000, endMs: 2000 },
      { text: 'Last', startMs: 4000, endMs: 6000 },
    ],
  });
});

test('YTMusic missing/invalid ends use next start then known duration', async () => {
  const result = await searchFixture(
    timedContents([
      { lyricLine: '♪', cueRange: { startTimeMilliseconds: '0' } },
      {
        lyricLine: 'Last',
        cueRange: { startTimeMilliseconds: '4000', endTimeMilliseconds: 'NaN' },
      },
      { lyricLine: 'invalid', cueRange: { startTimeMilliseconds: 'NaN' } },
    ]),
  );
  expect(result?.lines).toEqual([
    { text: '♪', startMs: 0, endMs: 4000 },
    { text: 'Last', startMs: 4000, endMs: 10000 },
  ]);
});

test('YTMusic plain lyrics remain exact and untimed', async () => {
  const result = await searchFixture({
    messageRenderer: { text: { runs: [{ text: '  Hello\n世界  ' }] } },
  });
  expect(result?.syncLevel).toBe('plain');
  expect(result?.lyrics).toBe('  Hello\n世界  ');
  expect(result?.lines).toBeUndefined();
});
