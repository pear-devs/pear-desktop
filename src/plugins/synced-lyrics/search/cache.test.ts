import { test, expect } from '@playwright/test';

import { LyricsCache, resultValid, candidatesValid } from './cache';
import { LyricsError } from './http';

import type { ProviderState } from '../providers';

const success: ProviderState = {
  state: 'done',
  error: null,
  candidates: [
    {
      id: 'one',
      provider: 'p',
      sourceId: 'one',
      result: {
        title: 'Song',
        artists: ['Artist'],
        syncLevel: 'syllable',
        lyrics: '  A! ',
        lines: [
          {
            text: '  A! ',
            startMs: -100,
            endMs: 1000,
            segments: [
              { text: '  A!', startMs: -100, endMs: 500 },
              { text: ' ', startMs: 600, endMs: 1000 },
            ],
          },
        ],
      },
    },
  ],
};

test('cache hit preserves exact nested domain and never shares mutable objects', () => {
  const cache = new LyricsCache();
  cache.set('song', 'p', success);
  const hit = cache.get('song', 'p')!;
  expect(hit).toEqual(success);
  hit.candidates[0].result.lines![0].segments![0].text = 'changed';
  hit.candidates[0].result.artists.push('changed');
  expect(cache.get('song', 'p')).toEqual(success);
});

test('cache configuration must keep finite positive capacity and TTLs', () => {
  for (const limit of [0, -1, Infinity, NaN])
    expect(() => new LyricsCache(limit)).toThrow('Invalid lyrics cache bounds');
  expect(() => new LyricsCache(75, Infinity)).toThrow(
    'Invalid lyrics cache bounds',
  );
  expect(() => new LyricsCache(75, 1000, NaN)).toThrow(
    'Invalid lyrics cache bounds',
  );
});

test('success TTL exceeds short error/no-result TTL; Error details survive', () => {
  let now = 0;
  const cache = new LyricsCache(75, 1000, 100, () => now);
  const failure: ProviderState = {
    state: 'error',
    candidates: [],
    error: new LyricsError('auth', 'Denied', 403),
  };
  cache.set('song', 'good', success);
  cache.set('song', 'error', failure);
  cache.set('song', 'empty', { state: 'done', candidates: [], error: null });
  expect(cache.get('song', 'error')?.error).toMatchObject({
    kind: 'auth',
    status: 403,
    message: 'Denied',
  });
  now = 100;
  expect(cache.get('song', 'error')).toBeUndefined();
  expect(cache.get('song', 'empty')).toBeUndefined();
  expect(cache.get('song', 'good')).toEqual(success);
  now = 1000;
  expect(cache.get('song', 'good')).toBeUndefined();
  expect(cache.size).toBe(0);
});

test('LRU bounds tracks, touching a hit preserves it; fetching/aborted results not cached', () => {
  const cache = new LyricsCache(2);
  cache.set('one', 'p', success);
  cache.set('two', 'p', success);
  cache.get('one', 'p');
  cache.set('three', 'p', success);
  expect(cache.size).toBe(2);
  expect(cache.get('two', 'p')).toBeUndefined();
  expect(cache.get('one', 'p')).toEqual(success);
  cache.set('abort', 'p', {
    state: 'error',
    candidates: [],
    error: new LyricsError('aborted', 'Cancelled'),
  });
  cache.set('loading', 'p', { state: 'fetching', candidates: [], error: null });
  expect(cache.get('abort', 'p')).toBeUndefined();
  expect(cache.get('loading', 'p')).toBeUndefined();
});

test('reject corrupted nested canonical data, including nonfinite/end/order/bounds violations', () => {
  const corruptions = [
    { text: 'bad', startMs: NaN },
    { text: 'bad', startMs: Infinity },
    { text: 'bad', startMs: -Infinity },
    { text: 'bad', startMs: 0, endMs: NaN },
    { text: 'bad', startMs: 0, endMs: Infinity },
    { text: 'bad', startMs: 100, endMs: 0 },
    {
      text: 'bad',
      startMs: 0,
      endMs: 100,
      segments: [{ text: 'outside', startMs: 200 }],
    },
    {
      text: 'bad',
      startMs: 0,
      endMs: 100,
      segments: [{ text: 'outside', startMs: 0, endMs: 200 }],
    },
    {
      text: 'bad',
      startMs: 0,
      segments: [
        { text: 'a', startMs: 100 },
        { text: 'b', startMs: 50 },
      ],
    },
    { text: 'bad', startMs: 0, segments: [{ text: 'a', startMs: null }] },
    { text: 'bad', startMs: -Number.MAX_VALUE, endMs: Number.MAX_VALUE },
  ];
  const cache = new LyricsCache();
  for (const line of corruptions) {
    const data = { ...success.candidates[0].result, lines: [line] };
    expect(resultValid(data)).toBe(false);
    expect(() =>
      cache.set('song', 'p', {
        ...success,
        candidates: [{ ...success.candidates[0], result: data }],
      } as ProviderState),
    ).toThrow('Invalid canonical');
  }
  expect(resultValid(success.candidates[0].result)).toBe(true);
  // Simulate corruption at cache boundary without weakening public API types.
  cache.set('song', 'p', success);
  const internals = cache as unknown as {
    tracks: Map<string, Map<string, { state: ProviderState }>>;
  };
  internals.tracks
    .get('song')!
    .get('p')!.state.candidates[0].result.lines![0].segments![0].startMs =
    Infinity;
  expect(cache.get('song', 'p')).toBeUndefined();
});

test('candidate cache validates source metadata and duplicate IDs without losing variants', () => {
  const item = success.candidates[0];
  expect(
    candidatesValid([
      item,
      { ...item, id: 'two', sourceId: 'two', durationMs: 2000, language: 'ja' },
    ]),
  ).toBe(true);
  expect(candidatesValid([item, item])).toBe(false);
  for (const durationMs of [NaN, Infinity, -1])
    expect(candidatesValid([{ ...item, durationMs }])).toBe(false);
  expect(candidatesValid([{ ...item, sourceId: '' }])).toBe(false);
});
