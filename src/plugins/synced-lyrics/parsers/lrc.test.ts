import { test, expect } from '@playwright/test';

import { LRC } from './lrc';

test('empty and malformed input recover without fabricated lyrics', () => {
  expect(LRC.parse('')).toEqual({ lines: [], tags: [], syncLevel: 'line' });
  expect(
    LRC.parse(
      'garbage\n[mm:ss.xx]bad\n[00:99.10]bad\n[00:01.1234]bad\n[offset:NaN]\n[00:00]ok',
    ).lines,
  ).toEqual([{ text: 'ok', startMs: 0 }]);
});

test('normal LRC sorts repeated timestamps and leaves final end unknown', () => {
  expect(
    LRC.parse('[00:21.10][00:45.10]Chorus\n[00:12.00]Line 1\n[00:17.20]Line 2')
      .lines,
  ).toEqual([
    { text: '', startMs: 0, endMs: 12000 },
    { text: 'Line 1', startMs: 12000, endMs: 17200 },
    { text: 'Line 2', startMs: 17200, endMs: 21100 },
    { text: 'Chorus', startMs: 21100, endMs: 45100 },
    { text: 'Chorus', startMs: 45100 },
  ]);
});

for (const offset of [0, 500, -500, -1500]) {
  test(`offset ${offset} preserves inferred line interval`, () => {
    const line = LRC.parse(
      `[00:01]First\n[00:04]Next\n[offset:${offset}]`,
    ).lines.find((line) => line.text === 'First')!;
    expect(line).toEqual({
      text: 'First',
      startMs: 1000 + offset,
      endMs: 4000 + offset,
    });
  });
  test(`offset ${offset} shifts lines and segments, preserves intervals`, () => {
    const parsed = LRC.parse(
      `[00:01]<00:01>I'd <00:02>sing<00:04>\n[00:04]Next\n[offset:${offset}]`,
    );
    const line = parsed.lines.find((line) => line.text === "I'd sing")!;
    expect(line.startMs).toBe(1000 + offset);
    expect(line.endMs).toBe(4000 + offset);
    expect(line.endMs! - line.startMs).toBe(3000);
    expect(line.segments).toEqual([
      { text: "I'd ", startMs: 1000 + offset, endMs: 2000 + offset },
      { text: 'sing', startMs: 2000 + offset, endMs: 4000 + offset },
    ]);
    expect(parsed.lines.at(-1)?.startMs).toBe(4000 + offset);
  });
}

for (const [stamp, startMs] of [
  ['00:01', 1000],
  ['00:01.1', 1100],
  ['00:01.12', 1120],
  ['00:01.123', 1123],
  ['01:02.03', 62030],
] as const) {
  test(`fractional timestamp ${stamp}`, () => {
    expect(LRC.parse(`[${stamp}]text`).lines.at(-1)?.startMs).toBe(startMs);
  });
}

test('enhanced text preserves Unicode, contractions, punctuation, syllables and spacing', () => {
  const fragments = [
    "I'd ",
    "you're  ",
    "don't,\t",
    'sa-',
    'te-',
    'llites! ',
    '世界 ',
    '愛してる ',
    '안녕하세요 ',
    '"And "  ',
  ];
  const source = fragments
    .map((text, index) => `<00:${String(index).padStart(2, '0')}.00>${text}`)
    .join('');
  const parsed = LRC.parse(`[00:00]${source}`);
  expect(parsed.syncLevel).toBe('word');
  expect(parsed.lines[0].text).toBe(fragments.join(''));
  expect(parsed.lines[0].segments?.map((segment) => segment.text)).toEqual(
    fragments,
  );
  expect(parsed.lines[0].segments?.at(-1)).toEqual({
    text: '"And "  ',
    startMs: 9000,
  });
});

test('untimed prefix and trailing marker are lossless and retain explicit ends', () => {
  const line = LRC.parse(
    '[00:00]  <00:01>Hello, <00:02>world!<00:03>\n[00:05]Next',
  ).lines[0];
  expect(line).toEqual({
    text: '  Hello, world!',
    startMs: 0,
    endMs: 3000,
    segments: [
      { text: '  ', startMs: 0, endMs: 1000 },
      { text: 'Hello, ', startMs: 1000, endMs: 2000 },
      { text: 'world!', startMs: 2000, endMs: 3000 },
    ],
  });
});

test('enhanced repeated timestamps shift independent segments', () => {
  const lines = LRC.parse(
    '[00:00][00:10]<00:00>sa-<00:01>te-<00:02>llites<00:03>',
  ).lines;
  expect(lines[1]).toEqual({
    text: 'sa-te-llites',
    startMs: 10000,
    endMs: 13000,
    segments: [
      { text: 'sa-', startMs: 10000, endMs: 11000 },
      { text: 'te-', startMs: 11000, endMs: 12000 },
      { text: 'llites', startMs: 12000, endMs: 13000 },
    ],
  });
  expect(lines[0].segments).not.toBe(lines[1].segments);
});

test('plain LRC content whitespace and CRLF are preserved', () => {
  expect(
    LRC.parse('\uFEFF[00:00]  Hello\t世界!  \r\n[00:02]Next').lines[0],
  ).toEqual({ text: '  Hello\t世界!  ', startMs: 0, endMs: 2000 });
});

test('blank intervals include short intro and timed whitespace lines', () => {
  expect(
    LRC.parse('[00:00.10]Hello\n[00:01]\n[00:02] \t\n[00:03]Bye').lines,
  ).toEqual([
    { text: '', startMs: 0, endMs: 100 },
    { text: 'Hello', startMs: 100, endMs: 1000 },
    { text: '', startMs: 1000, endMs: 2000 },
    { text: ' \t', startMs: 2000, endMs: 3000 },
    { text: 'Bye', startMs: 3000 },
  ]);
});

test('final line uses valid track duration, not Infinity or bogus end', () => {
  for (const duration of [undefined, NaN, Infinity, -1, 500]) {
    expect(LRC.parse('[00:01]Last', duration).lines.at(-1)).toEqual({
      text: 'Last',
      startMs: 1000,
    });
  }
  expect(LRC.parse('[00:01]Last', 5000).lines.at(-1)).toEqual({
    text: 'Last',
    startMs: 1000,
    endMs: 5000,
  });
});

test('metadata and last valid offset survive malformed offset', () => {
  const parsed = LRC.parse(
    '[ar: Artist]\n[ti:Title]\n[offset:500]\n[offset:bad]\n[00:00]text',
  );
  expect(parsed.tags).toEqual([
    { tag: 'ar', value: 'Artist' },
    { tag: 'ti', value: 'Title' },
  ]);
  expect(parsed.lines.at(-1)?.startMs).toBe(500);
});

test('malformed enhanced markers remain literal text; timing remains finite', () => {
  const line = LRC.parse('[00:00]<bad>世界<00:01>Hi<00:99>!').lines[0];
  expect(line.text).toBe('<bad>世界Hi<00:99>!');
  expect(line.segments?.map((segment) => segment.text).join('')).toBe(
    line.text,
  );
  const roundtrip = JSON.parse(JSON.stringify(LRC.parse('[00:00]last')));
  expect(roundtrip).toEqual({
    syncLevel: 'line',
    tags: [],
    lines: [{ text: 'last', startMs: 0 }],
  });
});
