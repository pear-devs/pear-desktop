import { test, expect } from '@playwright/test';

import {
  findClusterStart,
  groupIntoRuns,
  parseDuration,
  startsWithHeader,
  takeClusters,
} from './webm';

const element = (id: number[], body: number[]) => [
  ...id,
  0x40 | (body.length >> 8),
  body.length & 0xff,
  ...body,
];

const block = (relativeMs: number) =>
  element([0xa3], [0x81, relativeMs >> 8, relativeMs & 0xff, 0x80, 1, 2, 3]);

const cluster = (startMs: number, lastBlockMs: number) =>
  element(
    [0x1f, 0x43, 0xb6, 0x75],
    [
      ...element([0xe7], [startMs >> 8, startMs & 0xff]),
      ...block(0),
      ...block(lastBlockMs),
    ],
  );

const float64 = (value: number) => {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  return [...new Uint8Array(view.buffer)];
};

test('recognises a stream header', () => {
  expect(startsWithHeader(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f]))).toBe(
    true,
  );
  expect(startsWithHeader(new Uint8Array(cluster(0, 100)))).toBe(false);
});

test('reads the duration in seconds', () => {
  const header = new Uint8Array([0x44, 0x89, 0x88, ...float64(185210)]);
  expect(parseDuration(header)).toBeCloseTo(185.21);
});

test('applies a custom time scale', () => {
  const header = new Uint8Array([
    0x2a,
    0xd7,
    0xb1,
    0x83,
    // 2,000,000 ns per tick, twice the default, so ignoring it would fail.
    0x1e,
    0x84,
    0x80,
    0x44,
    0x89,
    0x88,
    ...float64(2000),
  ]);
  expect(parseDuration(header)).toBeCloseTo(4);
});

test('copes with a missing duration', () => {
  expect(parseDuration(new Uint8Array([1, 2, 3, 4, 5]))).toBeNull();
});

test('reads cluster times', () => {
  const { chunks, rest } = takeClusters(new Uint8Array(cluster(1000, 500)));
  expect(chunks).toHaveLength(1);
  expect(chunks[0].startMs).toBe(1000);
  expect(chunks[0].endMs).toBe(1520);
  expect(rest).toHaveLength(0);
});

test('keeps a split cluster for later', () => {
  const whole = new Uint8Array(cluster(0, 100));
  const first = takeClusters(whole.subarray(0, 9));
  expect(first.chunks).toHaveLength(0);

  const joined = new Uint8Array([...first.rest, ...whole.subarray(9)]);
  expect(takeClusters(joined).chunks).toHaveLength(1);
});

test('takes several clusters from one append', () => {
  const bytes = new Uint8Array([...cluster(0, 100), ...cluster(120, 100)]);
  expect(takeClusters(bytes).chunks).toHaveLength(2);
});

test('skips other elements between clusters', () => {
  const bytes = new Uint8Array([
    ...element([0xec], [0, 0, 0]),
    ...cluster(0, 100),
  ]);
  expect(takeClusters(bytes).chunks).toHaveLength(1);
});

test('groups unbroken audio, and splits at a seek', () => {
  const at = (startMs: number, endMs: number) => ({
    startMs,
    endMs,
    bytes: new Uint8Array(),
  });
  const runs = groupIntoRuns([
    at(20000, 25000),
    at(5000, 10000),
    at(0, 5000),
    at(10000, 15000),
  ]);
  expect(runs.map((run) => run.length)).toEqual([3, 1]);
});

test('ignores a timecode scale whose size runs past the header', () => {
  // Declares a huge payload; reading it used to loop for a very long time.
  const header = new Uint8Array([
    0x2a, 0xd7, 0xb1, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xfe,
  ]);
  expect(parseDuration(header)).toBeNull();
});

test('finds the first cluster after a header joined to it', () => {
  const ebml = element([0x1a, 0x45, 0xdf, 0xa3], [0x42, 0x86, 0x81, 0x01]);
  // A segment of unknown size, as streamed, holding info and then a cluster.
  const info = element([0x15, 0x49, 0xa9, 0x66], [0x1f, 0x43, 0xb6, 0x75]);
  const head = [
    ...ebml,
    0x18,
    0x53,
    0x80,
    0x67,
    0x01,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    ...info,
  ];
  const joined = new Uint8Array([...head, ...cluster(0, 20)]);

  // The cluster id inside `info` is part of its body, not a cluster.
  expect(findClusterStart(joined)).toBe(head.length);
  expect(findClusterStart(new Uint8Array(head))).toBe(head.length);
});
