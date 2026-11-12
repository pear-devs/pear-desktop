import { LyricsError } from './http';

import type { ProviderState } from '../providers';
import type {
  LyricCandidate,
  LyricLine,
  LyricResult,
  LyricSegment,
} from '../types';

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const optionalString = (value: unknown) =>
  value === undefined || typeof value === 'string';
const segmentValid = (value: unknown): value is LyricSegment =>
  record(value) &&
  typeof value.text === 'string' &&
  typeof value.startMs === 'number' &&
  Number.isFinite(value.startMs) &&
  (value.endMs === undefined ||
    (typeof value.endMs === 'number' &&
      Number.isFinite(value.endMs) &&
      value.endMs >= value.startMs &&
      Number.isFinite(value.endMs - value.startMs)));
const lineValid = (value: unknown): value is LyricLine => {
  if (
    !segmentValid(value) ||
    !record(value) ||
    !optionalString(value.translation) ||
    !optionalString(value.romanization)
  )
    return false;
  if (value.segments === undefined) return true;
  if (!Array.isArray(value.segments)) return false;
  let previous = value.startMs;
  for (const segment of value.segments) {
    if (
      !segmentValid(segment) ||
      segment.startMs < previous ||
      (value.endMs !== undefined &&
        (segment.startMs > value.endMs ||
          (segment.endMs !== undefined && segment.endMs > value.endMs)))
    )
      return false;
    previous = segment.startMs;
  }
  return true;
};

export const resultValid = (value: unknown): value is LyricResult => {
  if (
    !record(value) ||
    typeof value.title !== 'string' ||
    !Array.isArray(value.artists) ||
    !value.artists.every((artist) => typeof artist === 'string') ||
    !['plain', 'line', 'word', 'syllable'].includes(String(value.syncLevel)) ||
    !optionalString(value.lyrics)
  )
    return false;
  if (value.lines === undefined) return true;
  if (!Array.isArray(value.lines) || !value.lines.every(lineValid))
    return false;
  return value.lines.every(
    (line, index, lines) =>
      index === 0 || line.startMs >= lines[index - 1].startMs,
  );
};

// Explicit domain copy: never JSON-clone Errors, proxies, or arbitrary wire objects.
export const copyResult = (value: LyricResult): LyricResult => ({
  title: value.title,
  artists: [...value.artists],
  syncLevel: value.syncLevel,
  ...(value.lyrics !== undefined ? { lyrics: value.lyrics } : {}),
  ...(value.lines !== undefined
    ? {
        lines: value.lines.map((line) => ({
          text: line.text,
          startMs: line.startMs,
          ...(line.endMs !== undefined ? { endMs: line.endMs } : {}),
          ...(line.translation !== undefined
            ? { translation: line.translation }
            : {}),
          ...(line.romanization !== undefined
            ? { romanization: line.romanization }
            : {}),
          ...(line.segments !== undefined
            ? {
                segments: line.segments.map((segment) => ({
                  text: segment.text,
                  startMs: segment.startMs,
                  ...(segment.endMs !== undefined
                    ? { endMs: segment.endMs }
                    : {}),
                })),
              }
            : {}),
        })),
      }
    : {}),
});
export const candidateValid = (value: unknown): value is LyricCandidate =>
  record(value) &&
  typeof value.id === 'string' &&
  !!value.id &&
  typeof value.provider === 'string' &&
  !!value.provider &&
  typeof value.sourceId === 'string' &&
  !!value.sourceId &&
  resultValid(value.result) &&
  optionalString(value.album) &&
  optionalString(value.language) &&
  optionalString(value.variant) &&
  optionalString(value.exactVideoId) &&
  (value.durationMs === undefined ||
    (typeof value.durationMs === 'number' &&
      Number.isFinite(value.durationMs) &&
      value.durationMs >= 0));
export const candidatesValid = (value: unknown): value is LyricCandidate[] =>
  Array.isArray(value) &&
  value.every(candidateValid) &&
  new Set(value.map((candidate) => `${candidate.provider}:${candidate.id}`))
    .size === value.length;
export const copyCandidate = (candidate: LyricCandidate): LyricCandidate => ({
  id: candidate.id,
  provider: candidate.provider,
  sourceId: candidate.sourceId,
  result: copyResult(candidate.result),
  ...(candidate.album !== undefined ? { album: candidate.album } : {}),
  ...(candidate.durationMs !== undefined
    ? { durationMs: candidate.durationMs }
    : {}),
  ...(candidate.language !== undefined ? { language: candidate.language } : {}),
  ...(candidate.variant !== undefined ? { variant: candidate.variant } : {}),
  ...(candidate.exactVideoId !== undefined
    ? { exactVideoId: candidate.exactVideoId }
    : {}),
});
export const copyState = (state: ProviderState): ProviderState => ({
  ...state,
  candidates: state.candidates.map(copyCandidate),
  error:
    state.error instanceof LyricsError
      ? new LyricsError(
          state.error.kind,
          state.error.message,
          state.error.status,
        )
      : state.error
        ? new Error(state.error.message)
        : null,
});

type Entry = Map<string, { expires: number; state: ProviderState }>;
export class LyricsCache {
  private tracks = new Map<string, Entry>();
  constructor(
    private limit = 75,
    private successTtl = 30 * 60 * 1000,
    private failureTtl = 30000,
    private now = Date.now,
  ) {
    if (
      !Number.isInteger(limit) ||
      limit <= 0 ||
      !Number.isFinite(successTtl) ||
      successTtl <= 0 ||
      !Number.isFinite(failureTtl) ||
      failureTtl <= 0
    )
      throw new Error('Invalid lyrics cache bounds');
  }

  get size() {
    return this.tracks.size;
  }
  get(key: string, provider: string): ProviderState | undefined {
    const track = this.tracks.get(key);
    const entry = track?.get(provider);
    if (!entry) return;
    if (
      entry.expires <= this.now() ||
      !candidatesValid(entry.state.candidates)
    ) {
      this.delete(key, provider);
      return;
    }
    this.tracks.delete(key);
    this.tracks.set(key, track!);
    return copyState(entry.state);
  }
  set(key: string, provider: string, state: ProviderState) {
    if (
      state.state === 'fetching' ||
      (state.error instanceof LyricsError && state.error.kind === 'aborted')
    )
      return;
    if (!candidatesValid(state.candidates))
      throw new LyricsError('parse/schema', 'Invalid canonical lyrics');
    const track = this.tracks.get(key) ?? new Map();
    track.set(provider, {
      state: copyState(state),
      expires:
        this.now() +
        (state.candidates.some(
          (candidate) =>
            candidate.result.lines?.some((line) => line.text.trim()) ||
            candidate.result.lyrics?.trim(),
        )
          ? this.successTtl
          : this.failureTtl),
    });
    this.tracks.delete(key);
    this.tracks.set(key, track);
    while (this.tracks.size > this.limit)
      this.tracks.delete(this.tracks.keys().next().value!);
  }
  delete(key: string, provider: string) {
    const track = this.tracks.get(key);
    track?.delete(provider);
    if (!track?.size) this.tracks.delete(key);
  }
  clear() {
    this.tracks.clear();
  }
}
