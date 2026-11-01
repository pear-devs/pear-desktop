import type { ProviderName } from './providers';
import type { SongInfo } from '@/providers/song-info';

export type SyncedLyricsPluginConfig = {
  enabled: boolean;
  preferredProvider?: ProviderName;
  /** MusixMatch user token captured after the user logged in (see musixmatch-login.ts), empty when logged out */
  musixmatchToken?: string;
  /** app id the captured MusixMatch token belongs to (defaults to the desktop app id) */
  musixmatchAppId?: string;
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

export type LineLyricsStatus = 'previous' | 'current' | 'upcoming';

export type LineLyrics = {
  time: string;
  timeInMs: number;
  duration: number;

  text: string;
  status: LineLyricsStatus;
};

export type LineEffect = 'fancy' | 'scale' | 'offset' | 'focus';

export interface LyricResult {
  title: string;
  artists: string[];

  lyrics?: string;
  lines?: LineLyrics[];
}

// prettier-ignore
export type SearchSongInfo = Pick<SongInfo, 'title' | 'alternativeTitle' | 'artist' | 'album' | 'songDuration' | 'videoId' | 'tags'>;

/**
 * `RequestInit` as accepted by the `synced-lyrics:fetch` IPC handler.
 * An `AbortSignal` cannot cross the IPC bridge, so the main process aborts the request itself
 * after `timeout` milliseconds.
 */
export type NetFetchInit = RequestInit & { timeout?: number };

export interface LyricProvider {
  name: string;
  baseUrl: string;

  search(songInfo: SearchSongInfo): Promise<LyricResult | null>;
}
