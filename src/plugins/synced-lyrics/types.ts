import type { ProviderName } from './providers';
import type { SongInfo } from '@/providers/song-info';

export type SyncedLyricsPluginConfig = {
  enabled: boolean;
  preferredProvider: 'auto' | ProviderName;
  preciseTiming: boolean;
  showTimeCodes: boolean;
  defaultTextString: string | string[];
  showLyricsEvenIfInexact: boolean;
  lineEffect: LineEffect;
  romanization: boolean;
  convertChineseCharacter?:
    | 'simplifiedToTraditional'
    | 'traditionalToSimplified'
    | 'disabled';
};

export type SyncLevel = 'plain' | 'line' | 'word' | 'syllable';

export interface LyricSegment {
  text: string;
  startMs: number;
  endMs?: number;
}

export interface LyricLine extends LyricSegment {
  segments?: LyricSegment[];
  translation?: string;
  romanization?: string;
}

export type LineEffect = 'fancy' | 'scale' | 'offset' | 'focus';

export interface LyricResult {
  title: string;
  artists: string[];
  syncLevel: SyncLevel;

  // Exact plain text (also retained when a provider supplies a plain fallback).
  lyrics?: string;
  lines?: LyricLine[];
}

// prettier-ignore
export type SearchSongInfo = Pick<SongInfo, 'title' | 'alternativeTitle' | 'artist' | 'album' | 'songDuration' | 'videoId' | 'tags'>;

export interface LyricProvider {
  name: string;
  baseUrl: string;

  search(
    songInfo: SearchSongInfo,
    context?: SearchContext,
  ): Promise<LyricCandidate[]>;
}

// Source metadata stays separate from canonical timed content. IDs identify a
// source variant, not its rank or its position in a response array.
export interface LyricCandidate {
  id: string;
  provider: string;
  sourceId: string;
  result: LyricResult;
  album?: string;
  durationMs?: number;
  language?: string;
  variant?: string;
  exactVideoId?: string;
}

export interface SearchOptions {
  showLyricsEvenIfInexact: boolean;
}
export interface SearchContext {
  signal: AbortSignal;
}
