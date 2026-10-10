import type { LyricLine, LyricSegment } from './types';

const validEnd = (startMs: number, endMs?: number): endMs is number =>
  endMs !== undefined &&
  Number.isFinite(endMs) &&
  endMs >= startMs &&
  Number.isFinite(endMs - startMs);

// Invalid timing is removed, never clamped/reordered. The enclosing line.text
// still preserves all content, even when only some fragments remain timed.
const normalizeSegments = (line: LyricLine): LyricSegment[] => {
  const segments: LyricSegment[] = [];
  let previousStartMs = line.startMs;
  for (const source of line.segments ?? []) {
    if (
      !Number.isFinite(source.startMs) ||
      source.startMs < previousStartMs ||
      (line.endMs !== undefined && source.startMs > line.endMs)
    )
      continue;

    const segment = { ...source };
    if (
      !validEnd(segment.startMs, segment.endMs) ||
      (line.endMs !== undefined && segment.endMs > line.endMs)
    )
      delete segment.endMs;
    segments.push(segment);
    previousStartMs = segment.startMs;
  }
  return segments;
};

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
    const endMs = [
      line.endMs,
      lines[index + 1]?.startMs,
      trackDurationMs !== undefined && trackDurationMs > 0
        ? trackDurationMs
        : undefined,
    ].find((end) => validEnd(line.startMs, end));
    if (endMs === undefined) delete line.endMs;
    else line.endMs = endMs;
    if (line.segments !== undefined) line.segments = normalizeSegments(line);
  }

  const first = lines[0];
  if (first && first.startMs > 0) {
    lines.unshift({ text: '', startMs: 0, endMs: first.startMs });
  }
  return lines;
};
