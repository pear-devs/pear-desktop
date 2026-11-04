import { test, expect } from '@playwright/test';

import { formatOffset, nudgeOffset, OFFSET_STEP_MS } from './lyric-offset';

test('nudges in both directions', () => {
  expect(nudgeOffset(0, OFFSET_STEP_MS)).toBe(250);
  expect(nudgeOffset(250, -2 * OFFSET_STEP_MS)).toBe(-250);
});

test('stops at the limit', () => {
  expect(nudgeOffset(15000, OFFSET_STEP_MS)).toBe(15000);
  expect(nudgeOffset(-15000, -OFFSET_STEP_MS)).toBe(-15000);
});

test('shows the direction of the offset', () => {
  expect(formatOffset(500)).toBe('+0.50 s');
  expect(formatOffset(-1250)).toBe('-1.25 s');
  expect(formatOffset(0)).toBe('0.00 s');
});
