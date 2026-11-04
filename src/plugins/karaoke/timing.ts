// Lyrics are only timed per line, so the sweep is an estimate. Without this cap
// a line followed by a long instrumental break would crawl through the break.
const MAX_MS_PER_CHARACTER = 200;
const COUNTDOWN_BEAT_MS = 1000;
const COUNTDOWN_BEATS = 3;

export type TimedLine = {
  timeInMs: number;
  text: string;
  // `null` happens for real: the lyrics store clones through JSON, which turns
  // the `Infinity` duration of the last LRC line into `null`.
  duration: number | null;
};

export const findCurrentLineIndex = (lines: TimedLine[], timeInMs: number) => {
  for (let index = lines.length - 1; index >= 0; index--) {
    if (lines[index].timeInMs <= timeInMs) return index;
  }
  return -1;
};

/** How far through the line the sweep should be, from 0 to 1. */
export const getLineProgress = (line: TimedLine, timeInMs: number) => {
  const estimatedMs = line.text.trim().length * MAX_MS_PER_CHARACTER;
  const sweepMs =
    line.duration && line.duration > 0
      ? Math.min(line.duration, estimatedMs)
      : estimatedMs;

  if (sweepMs <= 0) return 1;
  return Math.min(1, Math.max(0, (timeInMs - line.timeInMs) / sweepMs));
};

/** Beats left before singing starts again, or 0 when no countdown is due. */
export const getCountdownBeats = (
  lines: TimedLine[],
  currentIndex: number,
  timeInMs: number,
) => {
  if (lines[currentIndex]?.text.trim()) return 0;

  const next = lines.slice(currentIndex + 1).find((line) => line.text.trim());
  if (!next) return 0;

  const beats = Math.ceil((next.timeInMs - timeInMs) / COUNTDOWN_BEAT_MS);
  return beats <= COUNTDOWN_BEATS ? Math.max(0, beats) : 0;
};
