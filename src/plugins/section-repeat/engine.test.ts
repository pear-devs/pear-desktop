import { test, expect } from '@playwright/test';

import {
  formatTime,
  parseTimeInput,
  resolveSeekTarget,
  type LoopState,
  type ParsedTimeInput,
  type PlayerSample,
} from './engine';

const EMPTY: ParsedTimeInput = { kind: 'empty' };
const INVALID: ParsedTimeInput = { kind: 'invalid' };
const time = (seconds: number): ParsedTimeInput => ({ kind: 'time', seconds });

const parseCases: { input: string; expected: ParsedTimeInput }[] = [
  { input: '', expected: EMPTY },
  { input: '0:30', expected: time(30) },
  { input: '5:00', expected: time(300) },
  { input: '1:02:03', expected: time(3723) },
  { input: ' 5:00 ', expected: time(300) },
  { input: '5', expected: time(5) },
  { input: '5:60', expected: INVALID },
  { input: '1:60:00', expected: INVALID },
  { input: 'abc', expected: INVALID },
  { input: '-5', expected: INVALID },
  { input: '1:2:3:4', expected: INVALID },
];

test.describe('parseTimeInput', () => {
  for (const { input, expected } of parseCases) {
    test(`parses ${JSON.stringify(input)}`, () => {
      expect(parseTimeInput(input)).toStrictEqual(expected);
    });
  }
});

const formatCases: { input: number; expected: string }[] = [
  { input: 300, expected: '5:00' },
  { input: 59, expected: '0:59' },
  { input: 0, expected: '0:00' },
  { input: 3723, expected: '1:02:03' },
  { input: 3599, expected: '59:59' },
  { input: NaN, expected: '0:00' },
  { input: -1, expected: '0:00' },
];

test.describe('formatTime', () => {
  for (const { input, expected } of formatCases) {
    test(`formats ${input}`, () => {
      expect(formatTime(input)).toBe(expected);
    });
  }
});

const loop = (overrides: Partial<LoopState> = {}): LoopState => ({
  active: true,
  startSeconds: null,
  endSeconds: null,
  ...overrides,
});

const sample = (overrides: Partial<PlayerSample> = {}): PlayerSample => ({
  currentTime: 0,
  duration: 0,
  paused: false,
  seeking: false,
  ...overrides,
});

const resolveCases: {
  name: string;
  state: LoopState;
  player: PlayerSample;
  expected: number | null;
}[] = [
  {
    name: 'inactive',
    state: loop({ active: false, startSeconds: 300, endSeconds: 340 }),
    player: sample({ currentTime: 340, duration: 400 }),
    expected: null,
  },
  {
    name: 'start null',
    state: loop({ endSeconds: 340 }),
    player: sample({ currentTime: 340, duration: 400 }),
    expected: null,
  },
  {
    name: 'paused',
    state: loop({ startSeconds: 300, endSeconds: 340 }),
    player: sample({ currentTime: 340, duration: 400, paused: true }),
    expected: null,
  },
  {
    name: 'seeking',
    state: loop({ startSeconds: 300, endSeconds: 340 }),
    player: sample({ currentTime: 340, duration: 400, seeking: true }),
    expected: null,
  },
  {
    name: 'currentTime NaN',
    state: loop({ startSeconds: 300, endSeconds: 340 }),
    player: sample({ currentTime: NaN, duration: 400 }),
    expected: null,
  },
  {
    name: 'start NaN',
    state: loop({ startSeconds: NaN, endSeconds: 340 }),
    player: sample({ currentTime: 340, duration: 400 }),
    expected: null,
  },
  {
    name: 'end equals start',
    state: loop({ startSeconds: 300, endSeconds: 300 }),
    player: sample({ currentTime: 340, duration: 400 }),
    expected: null,
  },
  {
    name: 'end below start',
    state: loop({ startSeconds: 300, endSeconds: 200 }),
    player: sample({ currentTime: 340, duration: 400 }),
    expected: null,
  },
  {
    name: 'no end and unknown duration',
    state: loop({ startSeconds: 300 }),
    player: sample({ currentTime: 340, duration: NaN }),
    expected: null,
  },
  {
    name: 'explicit end with currentTime at end',
    state: loop({ startSeconds: 300, endSeconds: 340 }),
    player: sample({ currentTime: 340, duration: 400 }),
    expected: 300,
  },
  {
    name: 'explicit end with currentTime exactly at threshold',
    state: loop({ startSeconds: 300, endSeconds: 340 }),
    player: sample({ currentTime: 339.95, duration: 400 }),
    expected: 300,
  },
  {
    name: 'duration end with currentTime exactly at threshold',
    state: loop({ startSeconds: 300 }),
    player: sample({ currentTime: 359.7, duration: 360 }),
    expected: 300,
  },
  {
    name: 'explicit end with NaN duration and currentTime past end',
    state: loop({ startSeconds: 300, endSeconds: 340 }),
    player: sample({ currentTime: 400, duration: NaN }),
    expected: 300,
  },
  {
    name: 'explicit end with NaN duration and currentTime at end',
    state: loop({ startSeconds: 300, endSeconds: 340 }),
    player: sample({ currentTime: 340, duration: NaN }),
    expected: 300,
  },
  {
    name: 'explicit end with Infinity duration and currentTime at end',
    state: loop({ startSeconds: 300, endSeconds: 340 }),
    player: sample({ currentTime: 340, duration: Infinity }),
    expected: 300,
  },
  {
    name: 'explicit end with currentTime just below threshold',
    state: loop({ startSeconds: 300, endSeconds: 340 }),
    player: sample({ currentTime: 339.9499999999999, duration: 400 }),
    expected: null,
  },
  {
    name: 'duration end with currentTime just below threshold',
    state: loop({ startSeconds: 300 }),
    player: sample({ currentTime: 359.69, duration: 360 }),
    expected: null,
  },
  {
    name: 'explicit end past the song end disarms a range collapsed into the tail',
    state: loop({ startSeconds: 300, endSeconds: 340 }),
    player: sample({ currentTime: 299.75, duration: 300 }),
    expected: null,
  },
  {
    name: 'explicit end past the song end disarms: below threshold',
    state: loop({ startSeconds: 300, endSeconds: 340 }),
    player: sample({ currentTime: 299.6, duration: 300 }),
    expected: null,
  },
  {
    name: 'explicit end past the song end disarms: currentTime past the end',
    state: loop({ startSeconds: 300, endSeconds: 340 }),
    player: sample({ currentTime: 340, duration: 300 }),
    expected: null,
  },
  {
    // The start sits just inside the last 0.3 s, so the to-end threshold
    // (299.7) is not 50 ms past it: arming would re-seek to 299.8 forever.
    name: 'start inside the last 0.3s of the song stays inactive',
    state: loop({ startSeconds: 299.8, endSeconds: 340 }),
    player: sample({ currentTime: 299.9, duration: 300 }),
    expected: null,
  },
  {
    name: 'explicit end equal to the song end clamps to the song end',
    state: loop({ startSeconds: 200, endSeconds: 300 }),
    player: sample({ currentTime: 299.75, duration: 300 }),
    expected: 200,
  },
  {
    name: 'explicit end equal to the song end clamps: below threshold',
    state: loop({ startSeconds: 200, endSeconds: 300 }),
    player: sample({ currentTime: 299.6, duration: 300 }),
    expected: null,
  },
  {
    // Threshold 299.7 sits well past the start, so the clamped range still
    // loops after the tail is reached from mid-song.
    name: 'explicit end past the song end still loops from mid-song',
    state: loop({ startSeconds: 180, endSeconds: 340 }),
    player: sample({ currentTime: 299.75, duration: 300 }),
    expected: 180,
  },
  {
    name: 'explicit end past the song end from mid-song: below threshold',
    state: loop({ startSeconds: 180, endSeconds: 340 }),
    player: sample({ currentTime: 299.6, duration: 300 }),
    expected: null,
  },
  {
    // A zero-length loop is rejected by the threshold invariant
    // (`threshold > start + 0.05`), even when both sit at the end.
    name: 'zero-length loop at the song end stays inactive',
    state: loop({ startSeconds: 300, endSeconds: 300 }),
    player: sample({ currentTime: 299.75, duration: 300 }),
    expected: null,
  },
  {
    name: 'zero-length loop at the song end stays inactive below threshold',
    state: loop({ startSeconds: 300, endSeconds: 300 }),
    player: sample({ currentTime: 299.6, duration: 300 }),
    expected: null,
  },
];

test.describe('resolveSeekTarget', () => {
  for (const { name, state, player, expected } of resolveCases) {
    test(name, () => {
      expect(resolveSeekTarget(state, player)).toBe(expected);
    });
  }
});
