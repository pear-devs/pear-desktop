import { test, expect } from '@playwright/test';

import { LRCLib } from './LRCLib';

import { configureElectronTransport } from '../search/electron-transport';
import { rankCandidates } from '../search/ranking';

const info = {
  title: 'Song',
  artist: 'Artist',
  album: 'Album',
  songDuration: 200,
  videoId: 'one',
};
test('LRCLib retains all variants and originals; common ranking alone rejects wrong song', async () => {
  const items = [
    {
      id: 1,
      trackName: 'Song',
      artistName: 'Artist',
      albumName: 'Album',
      duration: 200,
      syncedLyrics: '[00:00] Hello  世界!',
      plainLyrics: ' Hello  世界!',
    },
    {
      id: 2,
      trackName: 'Song',
      artistName: 'Artist',
      albumName: 'Compilation',
      duration: 202,
      plainLyrics: 'Other variant',
    },
    {
      id: 3,
      trackName: 'Wrong song',
      artistName: 'Unrelated',
      albumName: 'Other',
      duration: 100,
      syncedLyrics: '[00:00]Wrong',
    },
  ];
  configureElectronTransport(() =>
    Promise.resolve({ status: 200, headers: {}, body: JSON.stringify(items) }),
  );
  try {
    const candidates = await new LRCLib().search(info);
    expect(candidates.map((item) => item.id)).toEqual(['1', '2', '3']);
    expect(candidates[0]).toMatchObject({
      sourceId: '1',
      album: 'Album',
      durationMs: 200000,
    });
    expect(candidates[0].result.lines![0].text).toBe(' Hello  世界!');
    const ranked = rankCandidates(info, candidates, { allowInexact: true });
    expect(ranked[0].candidate.id).toBe('1');
    expect(
      ranked.find((item) => item.candidate.id === '3')?.evidence.eligible,
    ).toBe(false);
  } finally {
    configureElectronTransport(undefined);
  }
});
test('LRCLib broad query fallback retrieves regardless of allow-inexact policy', async () => {
  const urls: string[] = [];
  configureElectronTransport((_, _id, url) => {
    urls.push(String(url));
    return Promise.resolve({
      status: 200,
      headers: {},
      body: JSON.stringify(
        urls.length === 1
          ? []
          : [
              {
                id: 1,
                trackName: 'Song',
                artistName: 'Artist',
                duration: 200,
                plainLyrics: 'Text',
              },
            ],
      ),
    });
  });
  try {
    expect(await new LRCLib().search(info)).toHaveLength(1);
    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain('q=Song');
  } finally {
    configureElectronTransport(undefined);
  }
});
