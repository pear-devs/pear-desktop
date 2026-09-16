import { test, expect } from '@playwright/test';

import {
  lookupSaved,
  sanitizeSaved,
  upsertSaved,
  type SavedSection,
} from './saved';

const entry = (overrides: Partial<SavedSection> = {}): SavedSection => ({
  videoId: 'video-a',
  startSeconds: 10,
  endSeconds: 20,
  ...overrides,
});

const sanitizeCases: {
  name: string;
  raw: unknown;
  expected: SavedSection[];
}[] = [
  { name: 'null', raw: null, expected: [] },
  { name: 'record', raw: { videoId: 'video-a' }, expected: [] },
  { name: 'string', raw: 'video-a', expected: [] },
  { name: 'number', raw: 7, expected: [] },
  { name: 'empty array', raw: [], expected: [] },
  {
    name: 'non-object entries',
    raw: [null, 7, 'video-a', []],
    expected: [],
  },
  {
    name: 'missing videoId',
    raw: [{ startSeconds: 1, endSeconds: 2 }],
    expected: [],
  },
  { name: 'empty videoId', raw: [entry({ videoId: '' })], expected: [] },
  {
    name: 'non-string videoId',
    raw: [{ videoId: 7, startSeconds: 1, endSeconds: 2 }],
    expected: [],
  },
  { name: 'missing times', raw: [{ videoId: 'video-a' }], expected: [] },
  {
    name: 'both times null',
    raw: [entry({ startSeconds: null, endSeconds: null })],
    expected: [],
  },
  { name: 'negative start', raw: [entry({ startSeconds: -1 })], expected: [] },
  { name: 'NaN end', raw: [entry({ endSeconds: NaN })], expected: [] },
  {
    name: 'infinite start',
    raw: [entry({ startSeconds: Infinity })],
    expected: [],
  },
  {
    name: 'string time',
    raw: [entry({ endSeconds: '20' as unknown as number })],
    expected: [],
  },
  {
    name: 'keeps valid entries and drops garbage',
    raw: [
      null,
      entry({ videoId: 'video-b', startSeconds: 0, endSeconds: null }),
      entry({ videoId: 'video-c', startSeconds: null, endSeconds: 5 }),
      entry({ videoId: 'video-d', startSeconds: NaN, endSeconds: 5 }),
      entry({ videoId: 'video-e', startSeconds: null, endSeconds: null }),
    ],
    expected: [
      { videoId: 'video-b', startSeconds: 0, endSeconds: null },
      { videoId: 'video-c', startSeconds: null, endSeconds: 5 },
    ],
  },
  {
    name: 'dedupes by videoId keeping the last occurrence',
    raw: [
      entry({ videoId: 'video-a', startSeconds: 1, endSeconds: 2 }),
      entry({ videoId: 'video-b', startSeconds: 3, endSeconds: 4 }),
      entry({ videoId: 'video-a', startSeconds: 5, endSeconds: 6 }),
    ],
    expected: [
      { videoId: 'video-b', startSeconds: 3, endSeconds: 4 },
      { videoId: 'video-a', startSeconds: 5, endSeconds: 6 },
    ],
  },
];

test.describe('sanitizeSaved', () => {
  for (const { name, raw, expected } of sanitizeCases) {
    test(name, () => {
      expect(sanitizeSaved(raw)).toStrictEqual(expected);
    });
  }
});

const lookupCases: {
  name: string;
  saved: SavedSection[];
  videoId: string;
  expected: SavedSection | null;
}[] = [
  { name: 'empty list', saved: [], videoId: 'video-a', expected: null },
  {
    name: 'miss',
    saved: [entry({ videoId: 'video-b' })],
    videoId: 'video-a',
    expected: null,
  },
  {
    name: 'hit',
    saved: [entry({ videoId: 'video-b' }), entry({ endSeconds: null })],
    videoId: 'video-a',
    expected: { videoId: 'video-a', startSeconds: 10, endSeconds: null },
  },
  {
    name: 'keeps the last occurrence on a raw duplicate',
    saved: [
      entry({ startSeconds: 1, endSeconds: 2 }),
      entry({ startSeconds: 5, endSeconds: 6 }),
    ],
    videoId: 'video-a',
    expected: { videoId: 'video-a', startSeconds: 5, endSeconds: 6 },
  },
];

test.describe('lookupSaved', () => {
  for (const { name, saved, videoId, expected } of lookupCases) {
    test(name, () => {
      expect(lookupSaved(saved, videoId)).toStrictEqual(expected);
    });
  }
});

const upsertCases: {
  name: string;
  saved: SavedSection[];
  entry: SavedSection;
  expected: SavedSection[];
}[] = [
  {
    name: 'appends a new song',
    saved: [],
    entry: entry(),
    expected: [entry()],
  },
  {
    name: 'appends after existing songs',
    saved: [entry({ videoId: 'video-b' })],
    entry: entry({ startSeconds: 1, endSeconds: null }),
    expected: [
      entry({ videoId: 'video-b' }),
      entry({ startSeconds: 1, endSeconds: null }),
    ],
  },
  {
    name: 'replaces an existing song',
    saved: [
      entry({ startSeconds: 1, endSeconds: 2 }),
      entry({ videoId: 'video-b' }),
    ],
    entry: entry({ startSeconds: 7, endSeconds: 8 }),
    expected: [
      entry({ videoId: 'video-b' }),
      entry({ startSeconds: 7, endSeconds: 8 }),
    ],
  },
  {
    name: 'removes the entry when both times are null',
    saved: [entry(), entry({ videoId: 'video-b' })],
    entry: entry({ startSeconds: null, endSeconds: null }),
    expected: [entry({ videoId: 'video-b' })],
  },
  {
    name: 'removing an absent song changes nothing',
    saved: [entry({ videoId: 'video-b' })],
    entry: entry({ startSeconds: null, endSeconds: null }),
    expected: [entry({ videoId: 'video-b' })],
  },
  {
    name: 'removes every duplicate of the song',
    saved: [
      entry({ startSeconds: 1, endSeconds: 2 }),
      entry({ startSeconds: 3, endSeconds: 4 }),
    ],
    entry: entry({ startSeconds: null, endSeconds: null }),
    expected: [],
  },
];

test.describe('upsertSaved', () => {
  for (const { name, saved, entry: next, expected } of upsertCases) {
    test(name, () => {
      expect(upsertSaved(saved, next)).toStrictEqual(expected);
    });
  }
});
