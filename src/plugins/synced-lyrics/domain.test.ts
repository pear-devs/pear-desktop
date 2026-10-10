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

test('nested nonfinite starts are dropped; malformed ends become absent', () => {
  for (const invalid of [NaN, Infinity, -Infinity]) {
    const result = normalizeLines([
      {
        text: 'valid bad end',
        startMs: 0,
        endMs: 3000,
        segments: [
          { text: 'valid', startMs: 0, endMs: 1000 },
          { text: 'bad', startMs: invalid, endMs: 2000 },
          { text: 'end', startMs: 2000, endMs: invalid },
        ],
      },
    ]);
    expect(result).toEqual([
      {
        text: 'valid bad end',
        startMs: 0,
        endMs: 3000,
        segments: [
          { text: 'valid', startMs: 0, endMs: 1000 },
          { text: 'end', startMs: 2000 },
        ],
      },
    ]);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  }
});

test('segment bounds/ordering are checked without rewriting text or mutating source', () => {
  const source = [
    {
      text: 'all content survives',
      startMs: 1000,
      endMs: 3000,
      segments: [
        { text: 'before', startMs: 500, endMs: 800 },
        { text: 'valid', startMs: 1000, endMs: 1500 },
        { text: 'negative end', startMs: 1600, endMs: 1000 },
        { text: 'decreasing', startMs: 1500, endMs: 2000 },
        { text: 'outside end', startMs: 2000, endMs: 4000 },
        { text: 'after', startMs: 4000, endMs: 5000 },
      ],
    },
  ];
  const snapshot = JSON.stringify(source);
  expect(normalizeLines(source)[1]).toEqual({
    text: 'all content survives',
    startMs: 1000,
    endMs: 3000,
    segments: [
      { text: 'valid', startMs: 1000, endMs: 1500 },
      { text: 'negative end', startMs: 1600 },
      { text: 'outside end', startMs: 2000 },
    ],
  });
  expect(JSON.stringify(source)).toBe(snapshot);
});

test('valid overlapping, negative-offset and empty segments remain exact', () => {
  const source = [
    {
      text: ' sa-te- ',
      startMs: -1000,
      endMs: 1000,
      segments: [
        { text: ' ', startMs: -1000, endMs: -1000 },
        { text: 'sa-', startMs: -1000, endMs: 500 },
        { text: 'te- ', startMs: 0, endMs: 1000 },
        { text: '', startMs: 1000, endMs: 1000 },
      ],
    },
  ];
  expect(normalizeLines(source)).toEqual(source);
});

test('line nonfinite starts and invalid ends cannot leak through normalization', () => {
  for (const invalid of [NaN, Infinity, -Infinity]) {
    expect(
      normalizeLines([
        { text: 'invalid', startMs: invalid },
        { text: 'good', startMs: 0, endMs: invalid },
      ]),
    ).toEqual([{ text: 'good', startMs: 0 }]);
  }
});

test('finite endpoints with overflowing duration do not form canonical intervals', () => {
  expect(
    normalizeLines([
      {
        text: 'text',
        startMs: -Number.MAX_VALUE,
        endMs: Number.MAX_VALUE,
        segments: [
          { text: 'text', startMs: -Number.MAX_VALUE, endMs: Number.MAX_VALUE },
        ],
      },
    ]),
  ).toEqual([
    {
      text: 'text',
      startMs: -Number.MAX_VALUE,
      segments: [{ text: 'text', startMs: -Number.MAX_VALUE }],
    },
  ]);
});
