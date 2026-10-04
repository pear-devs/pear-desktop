import type { LyricLine } from './types';

/** Preserve source ends; infer missing ends without persisting duration/state. */
export const normalizeLines = (
  source: LyricLine[],
  trackDurationMs?: number,
): LyricLine[] => {
  const lines = source
    .filter((line) => Number.isFinite(line.startMs))
    .map((line) => ({ ...line }))
    .sort((a, b) => a.startMs - b.startMs);

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const validEnd = (end?: number): end is number =>
      end !== undefined && Number.isFinite(end) && end >= line.startMs;
    const endMs = [
      line.endMs,
      lines[index + 1]?.startMs,
      trackDurationMs !== undefined && trackDurationMs > 0
        ? trackDurationMs
        : undefined,
    ].find(validEnd);
    if (endMs === undefined) delete line.endMs;
    else line.endMs = endMs;
  }

  const first = lines[0];
  if (first && first.startMs > 0) {
    lines.unshift({ text: '', startMs: 0, endMs: first.startMs });
  }
  return lines;
};
