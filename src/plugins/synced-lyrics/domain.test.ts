import { test, expect } from '@playwright/test';

import { normalizeLines } from './domain';

import type { LyricResult } from './types';

test('canonical source ends, segment ends, translation and romanization survive normalization', () => {
  const source = [
    {
      text: '世界 ',
      startMs: 1000,
      endMs: 2000,
      translation: 'World ',
      romanization: 'sekai ',
      segments: [
        { text: '世', startMs: 1000, endMs: 1200 },
        { text: '界 ', startMs: 1300, endMs: 2000 },
      ],
    },
    { text: 'Next', startMs: 3000 },
  ];
  const normalized = normalizeLines(source, 5000);
  expect(normalized[0]).toEqual({ text: '', startMs: 0, endMs: 1000 });
  expect(normalized[1]).toEqual(source[0]);
  expect(normalized[2].endMs).toBe(5000);
  expect(source[1].endMs).toBeUndefined();
});

test('invalid ends are omitted or inferred without leaking nonfinite timing', () => {
  expect(normalizeLines([{ text: 'Last', startMs: 0 }], 0)).toEqual([
    { text: 'Last', startMs: 0 },
  ]);
  expect(
    normalizeLines(
      [
        { text: 'a', startMs: 0, endMs: Infinity },
        { text: 'b', startMs: 1000, endMs: 500 },
        { text: 'invalid', startMs: NaN },
      ],
      NaN,
    ),
  ).toEqual([
    { text: 'a', startMs: 0, endMs: 1000 },
    { text: 'b', startMs: 1000 },
  ]);
});

test('plain, line, word and syllable results serialize without playback state', () => {
  for (const syncLevel of ['plain', 'line', 'word', 'syllable'] as const) {
    const result: LyricResult = {
      title: 'Song',
      artists: ['Artist'],
      syncLevel,
      ...(syncLevel === 'plain'
        ? { lyrics: '  Hello\n世界  ' }
        : {
            lines: [
              {
                text: 'sa-te-',
                startMs: 0,
                segments: [
                  { text: 'sa-', startMs: 0, endMs: 100 },
                  { text: 'te-', startMs: 100 },
                ],
              },
            ],
          }),
    };
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(result).not.toHaveProperty('status');
    if (result.lines) {
      expect(result.lines[0]).not.toHaveProperty('status');
      expect(result.lines[0]).not.toHaveProperty('duration');
      expect(result.lines[0]).not.toHaveProperty('time');
    }
  }
});
