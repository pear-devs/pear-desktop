/* oxlint-disable @stylistic/no-mixed-operators */
export type ParsedTimeInput =
  | { kind: 'empty' }
  | { kind: 'invalid' }
  | { kind: 'time'; seconds: number };

export interface LoopState {
  active: boolean;
  startSeconds: number | null;
  endSeconds: number | null;
}

export interface PlayerSample {
  currentTime: number;
  duration: number;
  paused: boolean;
  seeking: boolean;
}

const TIME_PART = /^\d+$/;

/**
 * Accepts `ss`, `m:ss` and `h:mm:ss`. Every part is an integer, parts after
 * the first must be below 60, and junk (empty parts, signs, decimals, text)
 * is rejected.
 */
export function parseTimeInput(raw: string): ParsedTimeInput {
  const trimmed = raw.trim();
  if (trimmed === '') return { kind: 'empty' };

  const parts = trimmed.split(':');
  if (parts.length > 3) return { kind: 'invalid' };

  const values: number[] = [];
  for (const part of parts) {
    if (!TIME_PART.test(part)) return { kind: 'invalid' };
    const value = Number(part);
    if (!Number.isFinite(value)) return { kind: 'invalid' };
    values.push(value);
  }

  let seconds: number;
  if (values.length === 1) {
    seconds = values[0];
  } else if (values.length === 2) {
    const [minutes, secs] = values;
    if (secs >= 60) return { kind: 'invalid' };
    seconds = minutes * 60 + secs;
  } else {
    const [hours, minutes, secs] = values;
    if (minutes >= 60 || secs >= 60) return { kind: 'invalid' };
    seconds = hours * 3600 + minutes * 60 + secs;
  }

  if (!Number.isFinite(seconds) || seconds < 0) return { kind: 'invalid' };
  return { kind: 'time', seconds };
}

/** `m:ss` below one hour, `h:mm:ss` from one hour up; floors the input. */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';

  const total = Math.floor(seconds);
  const secs = total % 60;
  const mins = Math.floor((total % 3600) / 60);
  const hours = Math.floor(total / 3600);
  const pad = (value: number): string => String(value).padStart(2, '0');

  if (hours > 0) return `${hours}:${pad(mins)}:${pad(secs)}`;
  return `${mins}:${pad(secs)}`;
}

/**
 * Whether the loop is armed at all: Repeat on and at least one point set.
 * A blank `From` alone is the `Clear` state and never loops; blank `From`
 * with a set `To` engages a loop from the start of the song.
 */
export function isLoopEngaged(state: LoopState): boolean {
  return (
    state.active && (state.startSeconds !== null || state.endSeconds !== null)
  );
}

interface ArmedLoop {
  start: number;
  threshold: number;
}

/**
 * Resolves the loop into its start point and end threshold, or `null` when
 * it is disarmed: inactive, with no point set, without a finite start,
 * without a finite resolved end, or with a threshold that sits no more than
 * 50 ms past its start (a range collapsed into the song's tail). A blank
 * `From` starts the loop at `0:00`. A typed end that reaches or passes the
 * song's end is clamped to the song's end so the trigger sits just before
 * the end instead of beyond it.
 */
function resolveArmedLoop(
  state: LoopState,
  duration: number,
): ArmedLoop | null {
  if (!isLoopEngaged(state)) return null;

  // Blank From means the start of the song.
  const start = state.startSeconds ?? 0;
  if (!Number.isFinite(start)) return null;

  const end = state.endSeconds ?? duration;
  if (!Number.isFinite(end)) return null;

  const clampedToSongEnd =
    state.endSeconds !== null && Number.isFinite(duration) && end >= duration;
  const toSongEnd = state.endSeconds === null || clampedToSongEnd;
  const loopEnd = toSongEnd ? duration : end;
  const threshold = toSongEnd ? loopEnd - 0.3 : loopEnd - 0.05;
  if (!Number.isFinite(threshold)) return null;
  if (!(threshold > start + 0.05)) return null;
  return { start, threshold };
}

/**
 * Returns the start of the loop when playback crossed the end threshold,
 * otherwise `null`. Nothing is returned while disarmed, paused or seeking,
 * and never a non-finite value. Arming is shared with `resolveEndSeekTarget`.
 */
export function resolveSeekTarget(
  state: LoopState,
  player: PlayerSample,
): number | null {
  const armed = resolveArmedLoop(state, player.duration);
  if (armed === null) return null;
  if (player.paused || player.seeking) return null;
  if (!Number.isFinite(player.currentTime)) return null;
  return player.currentTime >= armed.threshold ? armed.start : null;
}

/**
 * Returns the start the natural end-of-song backstop should seek to, or
 * `null` when the loop is disarmed (the same arming rules as
 * `resolveSeekTarget`, without the playback-state gates).
 */
export function resolveEndSeekTarget(
  state: LoopState,
  duration: number,
): number | null {
  const armed = resolveArmedLoop(state, duration);
  return armed === null ? null : armed.start;
}
