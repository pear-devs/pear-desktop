import { test, expect } from '@playwright/test';

import { StreamList } from './audio-streams';

const float64 = (value: number) => {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  return [...new Uint8Array(view.buffer)];
};

const header = (seconds: number, marker = 0) =>
  new Uint8Array([
    0x1a,
    0x45,
    0xdf,
    0xa3,
    marker,
    0x44,
    0x89,
    0x88,
    ...float64(seconds * 1000),
  ]);

const element = (id: number[], body: number[]) => [
  ...id,
  0x40 | (body.length >> 8),
  body.length & 0xff,
  ...body,
];

const cluster = (startMs: number) =>
  new Uint8Array(
    element(
      [0x1f, 0x43, 0xb6, 0x75],
      [
        ...element([0xe7], [startMs >> 8, startMs & 0xff]),
        ...element([0xa3], [0x81, 0, 100, 0x80, 1, 2, 3]),
      ],
    ),
  );

test('finds the stream that matches the song, not the ad', () => {
  const list = new StreamList();
  const song = list.open(header(200));
  list.open(header(15));
  expect(list.find(200.4)).toBe(song);
});

test('continues a stream when the player repeats its header', () => {
  const list = new StreamList();
  const first = list.open(header(200));
  first.append(cluster(0));

  const second = list.open(header(200));
  second.append(cluster(5000));

  expect(second).toBe(first);
  expect(first.getChunks()).toHaveLength(2);
});

test('prefers the newest stream of the same length', () => {
  const list = new StreamList();
  list.open(header(200, 1));
  const newer = list.open(header(200, 2));
  expect(list.find(200)).toBe(newer);
});

test('a repeated header moves its stream to the front', () => {
  const list = new StreamList();
  const first = list.open(header(200, 1));
  list.open(header(200, 2));
  list.open(header(200, 1));
  expect(list.find(200)).toBe(first);
});

test('keeps the current song through a run of ads', () => {
  const list = new StreamList();
  const song = list.open(header(200));
  for (let ad = 1; ad <= 5; ad++) list.open(header(ad * 5));
  expect(list.find(200)).toBe(song);
});

test('recovers from a cluster that was abandoned part way', () => {
  const list = new StreamList();
  const stream = list.open(header(200));
  stream.append(cluster(0).subarray(0, 8));
  stream.append(cluster(5000));

  expect(stream.getChunks().map((it) => it.startMs)).toEqual([5000]);
});

test('still joins a cluster split across appends', () => {
  const list = new StreamList();
  const stream = list.open(header(200));
  const whole = cluster(1000);
  stream.append(whole.subarray(0, 8));
  stream.append(whole.subarray(8));

  expect(stream.getChunks()).toHaveLength(1);
});

test('reports when it is empty', () => {
  const list = new StreamList();
  expect(list.isEmpty).toBe(true);
  list.open(header(200));
  expect(list.isEmpty).toBe(false);
  list.clear();
  expect(list.isEmpty).toBe(true);
});

test('drops kept audio when a repeated header moves the timeline', () => {
  const list = new StreamList();
  const stream = list.open(header(200));
  stream.setTimeOffset(0);
  stream.append(cluster(0));
  const version = stream.version;

  stream.setTimeOffset(0);
  expect(stream.getChunks()).toHaveLength(1);

  stream.setTimeOffset(-0.05);
  expect(stream.getChunks()).toHaveLength(0);
  expect(stream.version).toBeGreaterThan(version);
});

test('marks decodes as stale only when the offset changes', () => {
  const stream = new StreamList().open(header(200));
  const revision = stream.revision;
  stream.append(cluster(0));
  stream.setTimeOffset(stream.timeOffset);
  expect(stream.revision).toBe(revision);

  stream.setTimeOffset(-0.05);
  expect(stream.revision).toBe(revision + 1);
});

test('never lets a stream of unknown length replace the song', () => {
  const list = new StreamList();
  const song = list.open(header(200));
  // An EBML header with no duration, such as an ad or a preload.
  const unknown = list.open(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x99]));

  expect(unknown.duration).toBeNull();
  expect(list.find(200)).toBe(song);
  // With nothing of the right length, an unknown stream is still a fallback.
  expect(list.find(30)).toBe(unknown);
});

test('keeps the song stream over a newer one of similar length', () => {
  const list = new StreamList();
  const song = list.open(header(200));
  const other = list.open(header(200.5, 1));

  expect(list.find(200)).toBe(other);
  expect(list.find(200, song)).toBe(song);
});

test('never swaps the song stream for one of unknown length', () => {
  const list = new StreamList();
  const song = list.open(header(200));
  list.clear();
  list.open(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x98]));

  // The song stream left the list, but it still fits, so it stays.
  expect(list.find(200, song)).toBe(song);
  // A stream of the wrong length is no answer while a known one is in use.
  expect(list.find(30, song)).toBeNull();
});
