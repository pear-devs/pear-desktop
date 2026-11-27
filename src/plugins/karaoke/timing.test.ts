import { test, expect } from '@playwright/test';

import {
  findCurrentLineIndex,
  getCountdownBeats,
  getLineProgress,
  type TimedLine,
} from './timing';

const lines: TimedLine[] = [
  { timeInMs: 0, text: '', duration: 10000 },
  { timeInMs: 10000, text: 'first line', duration: 1000 },
  { timeInMs: 11000, text: '', duration: 9000 },
  { timeInMs: 20000, text: 'last line', duration: null },
];

test('finds no line before the first timestamp', () => {
  expect(findCurrentLineIndex(lines.slice(1), 5000)).toBe(-1);
});

test('finds the line being sung, including exact boundaries', () => {
  expect(findCurrentLineIndex(lines, 10000)).toBe(1);
  expect(findCurrentLineIndex(lines, 10999)).toBe(1);
  expect(findCurrentLineIndex(lines, 99999)).toBe(3);
});

test('sweeps across the line duration', () => {
  expect(getLineProgress(lines[1], 10500)).toBe(0.5);
});

test('clamps the sweep after a seek', () => {
  expect(getLineProgress(lines[1], 9000)).toBe(0);
  expect(getLineProgress(lines[1], 15000)).toBe(1);
});

test('caps the sweep on a line followed by a long break', () => {
  const line = { timeInMs: 0, text: 'short', duration: 60000 };
  expect(getLineProgress(line, 1000)).toBe(1);
});

test('still sweeps a line whose duration was lost', () => {
  expect(getLineProgress(lines[3], 20900)).toBe(0.5);
  expect(
    getLineProgress({ timeInMs: 0, text: 'abcde', duration: 0 }, 500),
  ).toBe(0.5);
});

test('completes an empty line instead of dividing by zero', () => {
  expect(getLineProgress(lines[2], 11000)).toBe(1);
});

test('counts down only just before singing restarts', () => {
  expect(getCountdownBeats(lines, 0, 5000)).toBe(0);
  expect(getCountdownBeats(lines, 0, 7500)).toBe(3);
  expect(getCountdownBeats(lines, 2, 19500)).toBe(1);
});

test('counts down before the first line of a song', () => {
  expect(getCountdownBeats(lines.slice(1), -1, 8500)).toBe(2);
});

test('does not count down while singing or after the last line', () => {
  expect(getCountdownBeats(lines, 1, 10500)).toBe(0);
  expect(getCountdownBeats(lines, 3, 25000)).toBe(0);
});
