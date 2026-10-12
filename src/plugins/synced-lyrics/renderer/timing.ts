import type { LyricLine } from '../types';

export type LineStatus = 'previous' | 'current' | 'upcoming';

export const lineStatus = (line: LyricLine, timeMs: number): LineStatus => {
  if (timeMs < line.startMs) return 'upcoming';
  if (line.endMs !== undefined && timeMs >= line.endMs) return 'previous';
  return 'current';
};

export const lineDuration = (line: LyricLine): number | undefined =>
  line.endMs === undefined ? undefined : line.endMs - line.startMs;

export const blankProgress = (line: LyricLine, timeMs: number): number => {
  const duration = lineDuration(line);
  if (duration === undefined || duration <= 0) return 0;
  return Math.max(0, Math.min(1, (timeMs - line.startMs) / duration));
};

export const formatTimecode = (timeMs: number): string => {
  const sign = timeMs < 0 ? '-' : '';
  const absolute = Math.abs(Math.trunc(timeMs));
  const minutes = Math.floor(absolute / 60000);
  const seconds = Math.floor((absolute % 60000) / 1000);
  const fraction = Math.floor((absolute % 1000) / 10);
  return `${sign}${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(fraction).padStart(2, '0')}`;
};
