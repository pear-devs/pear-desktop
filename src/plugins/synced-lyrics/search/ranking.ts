import { matchCandidate, type MatchEvidence } from './matching';

import type { LyricCandidate, SearchSongInfo } from '../types';

export type SourceChoice = {
  kind: 'source';
  provider: string;
  candidateId: string | null;
};
export interface RankedCandidate {
  candidate: LyricCandidate;
  evidence: MatchEvidence;
  syncQuality: number;
}
export const syncQuality = ({ result }: LyricCandidate) => {
  const timed = result.lines?.some((line) => line.text.trim());
  if (!timed) return result.lyrics?.trim() ? 1 : 0;
  const segments = result.lines?.some((line) =>
    line.segments?.some((segment) => segment.text.trim()),
  );
  return segments && result.syncLevel === 'syllable'
    ? 4
    : segments && result.syncLevel === 'word'
      ? 3
      : 2;
};
const lexical = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export const rankCandidates = (
  track: SearchSongInfo,
  candidates: LyricCandidate[],
  options: { allowInexact?: boolean; preferredProvider?: string } = {},
): RankedCandidate[] => {
  const ranked = candidates.map((candidate) => ({
    candidate,
    evidence: matchCandidate(track, candidate, options.allowInexact),
    syncQuality: syncQuality(candidate),
  }));
  // Confidence bands make global preference a tie-breaker, not an override of
  // useful timing, eligibility, or substantially better identity evidence.
  return ranked.sort(
    (a, b) =>
      Number(b.evidence.eligible && b.syncQuality > 0) -
        Number(a.evidence.eligible && a.syncQuality > 0) ||
      Number(b.evidence.validity === 'confident') -
        Number(a.evidence.validity === 'confident') ||
      b.syncQuality - a.syncQuality ||
      Math.floor(b.evidence.confidence * 20) -
        Math.floor(a.evidence.confidence * 20) ||
      Number(b.evidence.exactSource) - Number(a.evidence.exactSource) ||
      Number(b.candidate.provider === options.preferredProvider) -
        Number(a.candidate.provider === options.preferredProvider) ||
      b.evidence.confidence - a.evidence.confidence ||
      lexical(a.candidate.provider, b.candidate.provider) ||
      lexical(a.candidate.id, b.candidate.id),
  );
};

export const selectCandidate = (
  ranked: RankedCandidate[],
  choice: SourceChoice | null,
) => {
  const useful = ranked.filter(
    (item) => item.evidence.eligible && item.syncQuality > 0,
  );
  const explicit = choice
    ? useful.find(
        ({ candidate }) =>
          candidate.provider === choice.provider &&
          (choice.candidateId === null || candidate.id === choice.candidateId),
      )
    : undefined;
  return {
    selected: explicit ?? useful[0],
    choice,
    unavailableChoice: !!choice && !explicit,
  };
};
