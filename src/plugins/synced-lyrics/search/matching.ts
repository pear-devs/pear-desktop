import { jaroWinkler } from '@skyra/jaro-winkler';

import type { LyricCandidate, SearchSongInfo } from '../types';

export const comparisonText = (text: string) =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');

export const normalizeTitle = (text: string) =>
  comparisonText(
    text
      // Only presentation noise, never arbitrary parenthetical/version metadata.
      .replace(
        /\b(?:official\s+(?:music\s+)?(?:video|audio|lyric(?:s)?\s+video)|lyrics?\s+video)\b/gi,
        '',
      )
      .replace(/\[(?:hd|4k|lyrics?)\]/gi, ''),
  );

const versionPatterns = [
  ['live', /\blive\b/],
  ['remix', /\bremix(?:ed)?\b/],
  ['remaster', /\bremaster(?:ed)?\b/],
  ['acoustic', /\bacoustic\b/],
  ['instrumental', /\binstrumental\b/],
  ['karaoke', /\bkaraoke\b/],
  ['sped up', /\bsped up\b/],
  ['slowed', /\bslowed(?: down)?\b/],
  ['edit', /\bedit\b/],
  ['mix', /\bmix\b/],
  ['version', /\bversion\b/],
] as const;

export const versionMarkers = (title: string) => {
  const canonicalVersion = (value: string) =>
    normalizeTitle(value)
      .replace(/\bremastered\b/g, 'remaster')
      .replace(/\bremixed\b/g, 'remix')
      .replace(/\bslowed down\b/g, 'slowed');
  const normalized = canonicalVersion(title);
  const markers = versionPatterns
    .filter(([, pattern]) => pattern.test(normalized))
    .map(([name]) => name as string);
  // Preserve named/year variants too: Radio Mix != Club Mix, 2009 != 2020 remaster.
  for (const suffix of title.matchAll(
    /\(([^)]+)\)|\[([^\]]+)\]|\s[-–—]\s(.+)$/g,
  )) {
    const value = canonicalVersion(suffix[1] ?? suffix[2] ?? suffix[3]);
    if (versionPatterns.some(([, pattern]) => pattern.test(value)))
      markers.push(value);
  }
  for (const phrase of normalized.matchAll(
    /\b[\p{L}\p{N}]+\s+(?:remix|mix|edit|version)\b/gu,
  ))
    markers.push(phrase[0]);
  const year = normalized.match(/\b(?:19|20)\d{2}\b/g);
  if (markers.length && year) markers.push(...year);
  return [...new Set(markers)].sort();
};

const similarity = (left: string, right: string) => {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const a = new Set(left.split(' '));
  const b = new Set(right.split(' '));
  const dice =
    (2 * [...a].filter((token) => b.has(token)).length) / (a.size + b.size);
  // Prefix similarity alone must not turn distinct titles/artists into matches.
  const tokenEvidence = 0.6 * dice;
  const characterEvidence = 0.4 * jaroWinkler(left, right);
  return tokenEvidence + characterEvidence;
};
const artists = (values: string[]) =>
  values
    .flatMap((value) => value.split(/\s*(?:&|,|;|\bfeat\.?|\bfeaturing)\s*/i))
    .map(comparisonText)
    .filter(Boolean);
const artistSimilarity = (expected: string[], actual: string[]) => {
  if (!expected.length || !actual.length) return 0;
  const coverage = (a: string[], b: string[]) =>
    a.reduce(
      (sum, item) =>
        sum + Math.max(...b.map((other) => similarity(item, other))),
      0,
    ) / a.length;
  return (coverage(expected, actual) + coverage(actual, expected)) / 2;
};

export const normalizeTrack = (track: SearchSongInfo) => ({
  titles: [
    track.title,
    ...(track.alternativeTitle ? [track.alternativeTitle] : []),
  ].map((original) => ({
    original,
    comparison: normalizeTitle(original),
    versions: versionMarkers(original),
  })),
  artists: artists([track.artist]),
  album: track.album ? comparisonText(track.album) : undefined,
  durationMs: track.songDuration * 1000,
  videoId: track.videoId,
});

export type DurationQuality =
  | 'unknown'
  | 'excellent'
  | 'acceptable'
  | 'suspicious'
  | 'reject';
export const durationEvidence = (
  trackMs: number,
  sourceMs?: number,
): { quality: DurationQuality; score?: number; deltaMs?: number } => {
  if (
    !Number.isFinite(trackMs) ||
    trackMs <= 0 ||
    sourceMs === undefined ||
    !Number.isFinite(sourceMs) ||
    sourceMs <= 0
  )
    return { quality: 'unknown' };
  const deltaMs = Math.abs(trackMs - sourceMs);
  if (deltaMs <= Math.max(2000, trackMs * 0.01))
    return { quality: 'excellent', score: 1, deltaMs };
  if (deltaMs <= Math.max(7000, trackMs * 0.03))
    return { quality: 'acceptable', score: 0.9, deltaMs };
  if (deltaMs <= Math.max(15000, trackMs * 0.08))
    return { quality: 'suspicious', score: 0.5, deltaMs };
  return { quality: 'reject', score: 0, deltaMs };
};

export interface MatchEvidence {
  titleScore: number;
  titleUsed: string;
  artistScore: number;
  albumScore?: number;
  duration: ReturnType<typeof durationEvidence>;
  exactSource: boolean;
  confidence: number;
  validity: 'confident' | 'inexact' | 'rejected';
  eligible: boolean;
  reasons: string[];
}

export const matchCandidate = (
  track: SearchSongInfo,
  candidate: LyricCandidate,
  allowInexact = false,
): MatchEvidence => {
  const normalized = normalizeTrack(track);
  const requiredVersions = normalized.titles[0].versions;
  const sourceVersions = versionMarkers(
    `${candidate.result.title}${candidate.variant ? ` (${candidate.variant})` : ''}`,
  ).join('|');
  const scored = normalized.titles.map((title) => ({
    title: title.original,
    score: similarity(title.comparison, normalizeTitle(candidate.result.title)),
    versionsAgree:
      (requiredVersions.length ? requiredVersions : title.versions).join(
        '|',
      ) === sourceVersions,
  }));
  scored.sort(
    (a, b) =>
      Number(b.versionsAgree) - Number(a.versionsAgree) || b.score - a.score,
  );
  const best = scored[0];
  const artistScore = artistSimilarity(
    normalized.artists,
    artists(candidate.result.artists),
  );
  const albumScore =
    normalized.album && candidate.album
      ? similarity(normalized.album, comparisonText(candidate.album))
      : undefined;
  const duration = durationEvidence(
    normalized.durationMs,
    candidate.durationMs,
  );
  const exactSource =
    !!track.videoId && candidate.exactVideoId === track.videoId;
  const reasons: string[] = [];
  // Authenticated exact association is stronger than translated/missing metadata.
  // A claim for a DIFFERENT video is a contradiction, never generic provider bias.
  if (candidate.exactVideoId && !exactSource)
    reasons.push('different source video');
  if (!exactSource) {
    if (!best.versionsAgree) reasons.push('recording/version mismatch');
    if (best.score < 0.75) reasons.push('title mismatch');
    if (artistScore < 0.8) reasons.push('artist mismatch');
    if (duration.quality === 'reject') reasons.push('duration mismatch');
  }
  const components = [
    [best.score, 0.5],
    [artistScore, 0.35],
    ...(albumScore === undefined ? [] : [[albumScore, 0.05]]),
    ...(duration.score === undefined ? [] : [[duration.score, 0.1]]),
  ];
  const confidence = exactSource
    ? 1
    : components.reduce((sum, [score, weight]) => {
        const weighted = score * weight;
        return sum + weighted;
      }, 0) / components.reduce((sum, [, weight]) => sum + weight, 0);
  const strong =
    exactSource ||
    (best.score >= 0.9 &&
      artistScore >= 0.9 &&
      confidence >= 0.88 &&
      duration.quality !== 'suspicious');
  const validity = reasons.length
    ? 'rejected'
    : strong
      ? 'confident'
      : 'inexact';
  if (validity === 'inexact')
    reasons.push(
      duration.quality === 'suspicious'
        ? 'suspicious duration'
        : 'low identity confidence',
    );
  return {
    titleScore: best.score,
    titleUsed: best.title,
    artistScore,
    albumScore,
    duration,
    exactSource,
    confidence,
    validity,
    eligible:
      validity === 'confident' || (validity === 'inexact' && allowInexact),
    reasons,
  };
};
