import { test, expect } from '@playwright/test';

import {
  findHeaderEnd,
  isMp4Header,
  parseMp4Header,
  startsWithFragment,
  takeFragments,
} from './mp4';

const u32 = (value: number) => [
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff,
];

const box = (type: string, ...parts: number[][]) => {
  const body = parts.flat();
  return [
    ...u32(body.length + 8),
    ...Array.from(type, (char) => char.charCodeAt(0)),
    ...body,
  ];
};

// version, flags, created, modified, timescale, duration
const times = (timescale: number, duration: number) => [
  ...u32(0),
  ...u32(0),
  ...u32(0),
  ...u32(timescale),
  ...u32(duration),
];

const header = ({ fragmentDuration = 0, movieDuration = 0 } = {}) =>
  new Uint8Array([
    ...box('ftyp', u32(0)),
    ...box(
      'moov',
      box('mvhd', times(1000, movieDuration)),
      box('trak', box('mdia', box('mdhd', times(44100, 0)))),
      box(
        'mvex',
        ...(fragmentDuration
          ? [box('mehd', u32(0), u32(fragmentDuration))]
          : []),
        box('trex', u32(0), u32(1), u32(1), u32(1024), u32(0), u32(0)),
      ),
    ),
  ]);

const fragment = (startSamples: number, sampleCount: number) => [
  ...box(
    'moof',
    box(
      'traf',
      box('tfhd', u32(0), u32(1)),
      box('tfdt', u32(0), u32(startSamples)),
      box('trun', u32(0), u32(sampleCount)),
    ),
  ),
  ...box('mdat', [1, 2, 3, 4]),
];

const info = parseMp4Header(header({ fragmentDuration: 200000 }));

test('recognises an MP4 header', () => {
  expect(isMp4Header(header())).toBe(true);
  expect(isMp4Header(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]))).toBe(false);
  expect(isMp4Header(new Uint8Array(fragment(0, 1)))).toBe(false);
});

test('recognises the start of a fragment', () => {
  expect(startsWithFragment(new Uint8Array(fragment(0, 1)))).toBe(true);
  expect(startsWithFragment(header())).toBe(false);
});

test('reads the track timing', () => {
  expect(info.timescale).toBe(44100);
  expect(info.defaultSampleDuration).toBe(1024);
});

test('reads the duration from the fragment total', () => {
  expect(info.duration).toBe(200);
});

test('falls back to the movie duration', () => {
  expect(parseMp4Header(header({ movieDuration: 185000 })).duration).toBe(185);
});

test('copes with no duration', () => {
  expect(parseMp4Header(header()).duration).toBeNull();
});

test('places a fragment in time', () => {
  const { chunks, rest } = takeFragments(
    new Uint8Array(fragment(44100, 43)),
    info,
  );
  expect(chunks).toHaveLength(1);
  expect(chunks[0].startMs).toBe(1000);
  expect(chunks[0].endMs).toBeCloseTo(1998.5, 0);
  expect(rest).toHaveLength(0);
});

test('reads per-sample durations when they are given', () => {
  const custom = box(
    'moof',
    box(
      'traf',
      box('tfhd', u32(0), u32(1)),
      box('tfdt', u32(0), u32(0)),
      box('trun', u32(0x000100), u32(2), u32(44100), u32(22050)),
    ),
  );
  const bytes = new Uint8Array([...custom, ...box('mdat', [1])]);
  expect(takeFragments(bytes, info).chunks[0].endMs).toBe(1500);
});

test('keeps a split fragment for later', () => {
  const whole = new Uint8Array(fragment(0, 10));
  const first = takeFragments(whole.subarray(0, whole.length - 2), info);
  expect(first.chunks).toHaveLength(0);

  const joined = new Uint8Array([
    ...first.rest,
    ...whole.subarray(whole.length - 2),
  ]);
  expect(takeFragments(joined, info).chunks).toHaveLength(1);
});

test('takes several fragments, and skips boxes between them', () => {
  const bytes = new Uint8Array([
    ...box('styp', u32(0)),
    ...fragment(0, 10),
    ...box('sidx', u32(0)),
    ...fragment(10240, 10),
  ]);
  expect(takeFragments(bytes, info).chunks).toHaveLength(2);
});

test('finds where a joined header ends', () => {
  const head = header();
  const joined = new Uint8Array([...head, ...fragment(0, 1)]);
  expect(findHeaderEnd(joined)).toBe(head.length);
  expect(findHeaderEnd(head)).toBe(head.length);
});
