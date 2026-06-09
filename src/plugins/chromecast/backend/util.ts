/**
 * Pure, dependency-free helpers for the chromecast backend.
 *
 * Kept free of any node/electron imports so they're trivially unit-testable
 * (and safe to import from anywhere). See `util.test.ts`.
 */

export interface NetworkInterfaceAddr {
  family: string;
  internal: boolean;
  address: string;
}

/** Pick the machine's first non-internal IPv4 address (for the proxy URL). */
export function computeLanIp(
  interfaces: Record<string, NetworkInterfaceAddr[] | undefined>,
): string {
  for (const addrs of Object.values(interfaces)) {
    for (const addr of addrs ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return '127.0.0.1';
}

export interface ByteRange {
  start: number;
  end: number;
}

/**
 * Parse an HTTP Range header against a known total length. Returns `null` when
 * there is no parseable range (caller should serve the full body, 200). For a
 * valid range it returns inclusive `{ start, end }` with `end` clamped to the
 * last byte; the caller is responsible for treating `start >= total` or
 * `start > end` as 416 Range Not Satisfiable.
 */
export function parseRange(
  rangeHeader: string | null | undefined,
  total: number,
): ByteRange | null {
  if (!rangeHeader) return null;
  // Only a single byte-range is supported; reject multipart ranges such as
  // "bytes=0-1,2-3" (the anchored regex won't match) so we fall back to a full
  // 200 response instead of mis-serving the first sub-range as a 206.
  const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return null;
  const start = Number.parseInt(match[1], 10);
  const end = match[2]
    ? Math.min(Number.parseInt(match[2], 10), total - 1)
    : total - 1;
  return { start, end };
}

/**
 * Estimate where playback should be now, given the last observed elapsed time
 * and the wall-clock moment it was observed, assuming real-time (1x) progress.
 */
export function expectedElapsed(
  baselineElapsed: number,
  baselineAtMs: number,
  nowMs: number,
): number {
  const secondsSinceBaseline = (nowMs - baselineAtMs) / 1000;
  return baselineElapsed + secondsSinceBaseline;
}

/**
 * Whether a new elapsed-time reading is a user scrub rather than normal
 * real-time progression since the baseline. A discontinuity larger than
 * `thresholdSec` (in either direction) counts as a seek.
 */
export function isSeek(
  baselineElapsed: number,
  baselineAtMs: number,
  newElapsed: number,
  nowMs: number,
  thresholdSec = 3,
): boolean {
  const expected = expectedElapsed(baselineElapsed, baselineAtMs, nowMs);
  return Math.abs(newElapsed - expected) > thresholdSec;
}
