import { test, expect } from '@playwright/test';

import {
  blankProgress,
  formatTimecode,
  lineDuration,
  lineStatus,
} from './timing';

test('playback status uses half-open intervals and unknown final end', () => {
  const line = { text: 'Hello', startMs: 1000, endMs: 4000 };
  expect(lineStatus(line, 999)).toBe('upcoming');
  expect(lineStatus(line, 1000)).toBe('current');
  expect(lineStatus(line, 3999)).toBe('current');
  expect(lineStatus(line, 4000)).toBe('previous');
  expect(lineStatus({ text: 'Last', startMs: 4000 }, 100000)).toBe('current');
  expect(line).not.toHaveProperty('status');
});

test('blank progress handles unknown and zero duration without division hazards', () => {
  expect(blankProgress({ text: '', startMs: 0, endMs: 0 }, 0)).toBe(0);
  expect(blankProgress({ text: '', startMs: 0 }, 100)).toBe(0);
  const line = { text: '', startMs: 0, endMs: 1000 };
  expect(blankProgress(line, -1)).toBe(0);
  expect(blankProgress(line, 500)).toBe(0.5);
  expect(blankProgress(line, 2000)).toBe(1);
  expect(lineDuration(line)).toBe(1000);
  expect(lineDuration({ text: '', startMs: 0 })).toBeUndefined();
});

test('timecodes are presentation-only including negative offsets', () => {
  expect(formatTimecode(62123)).toBe('01:02.12');
  expect(formatTimecode(-500)).toBe('-00:00.50');
  expect(formatTimecode(0)).toBe('00:00.00');
});
