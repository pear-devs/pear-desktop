// Shared between the host (providers) and the page (renderer).

export const PROVIDERS = ["lrclib", "ytmusic", "genius"] as const;
export type ProviderId = (typeof PROVIDERS)[number];

export const PROVIDER_NAMES: Record<ProviderId, string> = {
  lrclib: "LRCLIB",
  ytmusic: "YT Music",
  genius: "Genius",
};

export interface LyricWord {
  startMs: number;
  endMs: number;
  /** Includes its trailing whitespace, so joining words gives the line. */
  text: string;
}

export interface LyricLine {
  startMs: number;
  endMs: number;
  /** Empty for instrumental gaps. */
  text: string;
  /** Present when the provider has word-level timing. */
  words?: LyricWord[];
}

export interface LyricResult {
  title: string;
  artists: string[];
  /** Time-synced lines, sorted by start. */
  lines?: LyricLine[];
  /** Unsynced lyrics, newline separated. */
  plain?: string;
}

export interface SearchQuery {
  videoId: string;
  title: string;
  artist: string;
  album?: string;
  durationSeconds: number;
  /** Accept looser matches (title-only search). */
  inexact: boolean;
}

/** How good a result is: word sync > line sync > plain text > nothing. */
export function resultRank(result: LyricResult | null | undefined) {
  if (!result) return 0;
  if (result.lines?.some((line) => line.words?.length)) return 3;
  if (result.lines?.length) return 2;
  return result.plain?.trim() ? 1 : 0;
}
