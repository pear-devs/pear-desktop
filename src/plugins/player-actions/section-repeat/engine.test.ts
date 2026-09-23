import { test, expect } from '@playwright/test';

import {
  formatTime,
  isLoopEngaged,
  parseTimeInput,
  resolveEndSeekTarget,
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
    // A blank From now starts the loop at the song's start.
    name: 'start null',
    state: loop({ endSeconds: 340 }),
    player: sample({ currentTime: 340, duration: 400 }),
    expected: 0,
  },
  {
    name: 'to-only loop arms at the song start',
    state: loop({ endSeconds: 340 }),
    player: sample({ currentTime: 0, duration: 400 }),
    expected: null,
  },
  {
    name: 'to-only loop triggers at the end threshold',
    state: loop({ endSeconds: 340 }),
    player: sample({ currentTime: 339.95, duration: 400 }),
    expected: 0,
  },
  {
    name: 'to-only loop just below the end threshold stays put',
    state: loop({ endSeconds: 340 }),
    player: sample({ currentTime: 339.9499999999999, duration: 400 }),
    expected: null,
  },
  {
    name: 'to-only loop past the song end clamps to the song end',
    state: loop({ endSeconds: 340 }),
    player: sample({ currentTime: 299.75, duration: 300 }),
    expected: 0,
  },
  {
    name: 'to-only loop past the song end clamps: below threshold',
    state: loop({ endSeconds: 340 }),
    player: sample({ currentTime: 299.6, duration: 300 }),
    expected: null,
  },
  {
    // Both points blank is the Clear state: nothing arms.
    name: 'clear stays disarmed',
    state: loop(),
    player: sample({ currentTime: 100, duration: 400 }),
    expected: null,
  },
  {
    // A 0:00 -> 0.2 map collapses into the song tail (threshold -0.1),
    // so the threshold invariant keeps it disarmed.
    name: 'to-only loop collapsed into the song tail stays disarmed',
    state: loop({ endSeconds: 0.2 }),
    player: sample({ currentTime: 0.15, duration: 0.2 }),
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

const endSeekCases: {
  name: string;
  state: LoopState;
  duration: number;
  expected: number | null;
}[] = [
  {
    name: 'inactive',
    state: loop({ active: false, startSeconds: 300, endSeconds: 340 }),
    duration: 300,
    expected: null,
  },
  {
    // A blank From now resolves the restore point to the song's start.
    name: 'start null',
    state: loop({ endSeconds: 340 }),
    duration: 300,
    expected: 0,
  },
  {
    name: 'to-only loop resolves to the song start',
    state: loop({ endSeconds: 340 }),
    duration: 400,
    expected: 0,
  },
  {
    name: 'clear resolves to nothing',
    state: loop(),
    duration: 400,
    expected: null,
  },
  {
    name: 'to-only loop collapsed into the song tail stays disarmed',
    state: loop({ endSeconds: 0.2 }),
    duration: 0.2,
    expected: null,
  },
  {
    name: 'to-end loop whose start sits at the song end stays disarmed',
    state: loop({ startSeconds: 300 }),
    duration: 300,
    expected: null,
  },
  {
    name: 'start inside the last 0.3s of the song stays disarmed',
    state: loop({ startSeconds: 299.8, endSeconds: 340 }),
    duration: 300,
    expected: null,
  },
  {
    name: 'start at the song end stays disarmed',
    state: loop({ startSeconds: 300, endSeconds: 340 }),
    duration: 300,
    expected: null,
  },
  {
    name: 'no end and unknown duration',
    state: loop({ startSeconds: 300 }),
    duration: NaN,
    expected: null,
  },
  {
    name: 'to-end loop',
    state: loop({ startSeconds: 200 }),
    duration: 300,
    expected: 200,
  },
  {
    name: 'explicit end past the song end still loops from mid-song',
    state: loop({ startSeconds: 200, endSeconds: 340 }),
    duration: 300,
    expected: 200,
  },
  {
    name: 'explicit end inside the song',
    state: loop({ startSeconds: 300, endSeconds: 340 }),
    duration: 999,
    expected: 300,
  },
];

test.describe('resolveEndSeekTarget', () => {
  for (const { name, state, duration, expected } of endSeekCases) {
    test(name, () => {
      expect(resolveEndSeekTarget(state, duration)).toBe(expected);
    });
  }
});

const engagedCases: { name: string; state: LoopState; expected: boolean }[] = [
  {
    name: 'active with no points is disarmed',
    state: loop(),
    expected: false,
  },
  {
    name: 'inactive with an explicit range is disarmed',
    state: loop({ active: false, startSeconds: 300, endSeconds: 340 }),
    expected: false,
  },
  {
    name: 'inactive with a blank From and an end is disarmed',
    state: loop({ active: false, endSeconds: 340 }),
    expected: false,
  },
  {
    name: 'blank From with an end is engaged',
    state: loop({ endSeconds: 340 }),
    expected: true,
  },
  {
    name: 'explicit From with a blank end is engaged',
    state: loop({ startSeconds: 300 }),
    expected: true,
  },
  {
    name: 'explicit range is engaged',
    state: loop({ startSeconds: 300, endSeconds: 340 }),
    expected: true,
  },
  {
    name: 'a non-finite From is still engaged (the resolve guard disarms it)',
    state: loop({ startSeconds: NaN, endSeconds: 340 }),
    expected: true,
  },
];

test.describe('isLoopEngaged', () => {
  for (const { name, state, expected } of engagedCases) {
    test(name, () => {
      expect(isLoopEngaged(state)).toBe(expected);
    });
  }
});
