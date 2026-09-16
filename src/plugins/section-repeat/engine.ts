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
 * Returns the start of the loop when playback crossed the end threshold,
 * otherwise `null`. Nothing is returned while inactive, without a start
 * point, paused or seeking, and never a non-finite value. A typed end that
 * reaches or passes the song's end is clamped to the song's end so the
 * trigger sits just before the end instead of beyond it. A loop is only
 * armed while its threshold sits at least 50 ms past its start, so a range
 * that has collapsed into the song's tail stays inactive.
 */
export function resolveSeekTarget(
  state: LoopState,
  player: PlayerSample,
): number | null {
  if (!state.active) return null;

  const start = state.startSeconds;
  if (start === null || !Number.isFinite(start)) return null;
  if (player.paused || player.seeking) return null;
  if (!Number.isFinite(player.currentTime)) return null;

  const end = state.endSeconds ?? player.duration;
  if (!Number.isFinite(end)) return null;

  const clampedToSongEnd =
    state.endSeconds !== null &&
    Number.isFinite(player.duration) &&
    end >= player.duration;
  const toSongEnd = state.endSeconds === null || clampedToSongEnd;
  const loopEnd = toSongEnd ? player.duration : end;
  const threshold = toSongEnd ? loopEnd - 0.3 : loopEnd - 0.05;
  if (!Number.isFinite(threshold)) return null;
  if (!(threshold > start + 0.05)) return null;
  return player.currentTime >= threshold ? start : null;
}
