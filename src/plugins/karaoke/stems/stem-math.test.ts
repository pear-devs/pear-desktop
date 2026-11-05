import { test, expect } from '@playwright/test';

import {
  BLOCK_SAMPLES,
  getBlockAt,
  getBlockCount,
  getOverlapWeight,
  pickNextBlock,
  placeRun,
  SEGMENT_SAMPLES,
  SOURCE_SAMPLE_RATE,
} from './stem-math';

const blockSeconds = BLOCK_SAMPLES / SOURCE_SAMPLE_RATE;

test('counts a partly filled last block', () => {
  expect(getBlockCount(BLOCK_SAMPLES)).toBe(1);
  expect(getBlockCount(BLOCK_SAMPLES + 1)).toBe(2);
});

test('finds the block at a time', () => {
  expect(getBlockAt(0)).toBe(0);
  expect(getBlockAt(blockSeconds * 2.5)).toBe(2);
  expect(getBlockAt(-1)).toBe(0);
});

test('starts at the playhead', () => {
  expect(pickNextBlock(new Set(), blockSeconds * 3.2, 30)).toBe(3);
});

test('skips finished blocks', () => {
  expect(pickNextBlock(new Set([3, 4]), blockSeconds * 3.2, 30)).toBe(5);
});

test('goes back to fill the gap after a seek', () => {
  expect(pickNextBlock(new Set([5, 6]), 0, 30)).toBe(0);
});

test('stops when far enough ahead', () => {
  const done = new Set(Array.from({ length: 30 }, (_, block) => block));
  done.delete(20);
  expect(pickNextBlock(done, 0, 30)).toBeNull();
});

test('stops at the end of the song', () => {
  expect(pickNextBlock(new Set([0, 1]), 0, 2)).toBeNull();
});

test('waits for audio that has not arrived', () => {
  expect(pickNextBlock(new Set(), 0, 30, (block) => block > 1)).toBe(2);
  expect(pickNextBlock(new Set(), 0, 30, () => false)).toBeNull();
});

test('places a run at its start time', () => {
  expect(placeRun(1000, 0)).toEqual({ target: 44100, skip: 0 });
});

test('applies the shift of the stream', () => {
  expect(placeRun(1000, -0.5)).toEqual({ target: 22050, skip: 0 });
});

test('drops what a shift moves before the start of the song', () => {
  expect(placeRun(0, -0.1)).toEqual({ target: 0, skip: 4410 });
});

test('fades segments in and out', () => {
  expect(getOverlapWeight(0, SEGMENT_SAMPLES)).toBe(0);
  expect(getOverlapWeight(SEGMENT_SAMPLES / 2, SEGMENT_SAMPLES)).toBe(1);
  expect(getOverlapWeight(SEGMENT_SAMPLES, SEGMENT_SAMPLES)).toBe(0);
});
