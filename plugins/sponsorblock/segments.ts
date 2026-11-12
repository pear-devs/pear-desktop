// Pure segment logic: the host filters API answers, the page decides when to skip.

/** [start, end] in seconds. */
export type Segment = [number, number];

export interface Submission {
  segment: Segment;
  category: string;
  actionType: string;
  /** Duration of the video when the segment was submitted; 0 when unknown. */
  videoDuration: number;
}

// Segments submitted against a different cut of the video would skip the wrong part.
const DURATION_TOLERANCE_S = 3;
// Closer than this to a segment's end is not worth a seek (and avoids seek loops).
const MIN_SKIP_S = 0.3;

/** Sorts segments and merges overlapping or touching ones. */
export function mergeSegments(segments: readonly Segment[]): Segment[] {
  const sorted = segments.map(([s, e]): Segment => [s, e]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Segment[] = [];
  for (const segment of sorted) {
    const last = merged.at(-1);
    if (last && segment[0] <= last[1]) last[1] = Math.max(last[1], segment[1]);
    else merged.push(segment);
  }
  return merged;
}

/** Skippable segments for media of `duration` seconds (0 = unknown). */
export function usableSegments(submissions: readonly Submission[], duration: number): Segment[] {
  return mergeSegments(
    submissions
      .filter((s) => s.actionType === "skip" && s.segment[1] > s.segment[0])
      .filter((s) => !duration || !s.videoDuration || Math.abs(s.videoDuration - duration) <= DURATION_TOLERANCE_S)
      .map((s) => s.segment),
  );
}

/** Where to seek to from `time`, or undefined when not inside a segment. */
export function skipTarget(segments: readonly Segment[], time: number): number | undefined {
  for (const [start, end] of segments) {
    if (time >= start && time < end - MIN_SKIP_S) return end;
  }
  return undefined;
}
