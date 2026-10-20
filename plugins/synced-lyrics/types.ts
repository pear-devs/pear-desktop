// Shared between the host (providers) and the page (renderer).

// The ids are pear-desktop's provider names, which its `preferredProvider` setting stores.
export const PROVIDERS = ["LRCLib", "YTMusic", "MusixMatch", "Megalobiz", "LyricsGenius"] as const;
export type ProviderId = (typeof PROVIDERS)[number];

export const PROVIDER_NAMES: Record<ProviderId, string> = {
  LRCLib: "LRCLIB",
  YTMusic: "YT Music",
  MusixMatch: "Musixmatch",
  Megalobiz: "Megalobiz",
  LyricsGenius: "Genius",
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
  /** The lyrics' page at the provider, for providers that ask to be linked. */
  url?: string;
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
