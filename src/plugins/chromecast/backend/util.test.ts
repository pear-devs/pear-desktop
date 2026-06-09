import { test, expect } from '@playwright/test';

import { computeLanIp, expectedElapsed, isSeek, parseRange } from './util';

test('computeLanIp returns the first non-internal IPv4 address', () => {
  const ip = computeLanIp({
    lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
    eth0: [
      { family: 'IPv6', internal: false, address: 'fe80::1' },
      { family: 'IPv4', internal: false, address: '192.168.88.13' },
    ],
  });
  expect(ip).toBe('192.168.88.13');
});

test('computeLanIp falls back to loopback when nothing qualifies', () => {
  expect(computeLanIp({})).toBe('127.0.0.1');
  expect(
    computeLanIp({
      lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
      tun: [{ family: 'IPv6', internal: false, address: '::1' }],
      empty: undefined,
    }),
  ).toBe('127.0.0.1');
});

test('parseRange returns null without a (valid) Range header', () => {
  expect(parseRange(null, 1000)).toBeNull();
  expect(parseRange(undefined, 1000)).toBeNull();
  expect(parseRange('bytes=abc', 1000)).toBeNull();
});

test('parseRange rejects multipart ranges (single-range only)', () => {
  expect(parseRange('bytes=0-1,2-3', 1000)).toBeNull();
  expect(parseRange('bytes=0-99, 200-299', 1000)).toBeNull();
});

test('parseRange parses an explicit start-end range', () => {
  expect(parseRange('bytes=100-200', 1000)).toEqual({ start: 100, end: 200 });
});

test('parseRange treats an open-ended range as through the last byte', () => {
  expect(parseRange('bytes=100-', 1000)).toEqual({ start: 100, end: 999 });
  expect(parseRange('bytes=0-', 500)).toEqual({ start: 0, end: 499 });
});

test('parseRange clamps end to the last byte', () => {
  expect(parseRange('bytes=0-99999', 1000)).toEqual({ start: 0, end: 999 });
});

test('expectedElapsed advances at real time from the baseline', () => {
  // 10s elapsed at t=1000ms; 2000ms later -> 12s.
  expect(expectedElapsed(10, 1000, 3000)).toBeCloseTo(12, 5);
});

test('isSeek ignores normal ~1s/tick progression', () => {
  // baseline 10s @ t0; ~1s later reports 11s -> not a seek.
  expect(isSeek(10, 0, 11, 1000)).toBe(false);
  // small jitter within the threshold.
  expect(isSeek(10, 0, 12, 1000)).toBe(false);
});

test('isSeek detects a large forward jump (scrub ahead)', () => {
  // baseline 10s @ t0; 1s later reports 60s -> seek.
  expect(isSeek(10, 0, 60, 1000)).toBe(true);
});

test('isSeek detects a backward jump (scrub back)', () => {
  // baseline 100s @ t0; 1s later reports 5s -> seek.
  expect(isSeek(100, 0, 5, 1000)).toBe(true);
});

test('isSeek honours a custom threshold', () => {
  // 4s discontinuity is a seek at default 3s, but not at 5s.
  expect(isSeek(10, 0, 15, 1000)).toBe(true);
  expect(isSeek(10, 0, 15, 1000, 5)).toBe(false);
});
