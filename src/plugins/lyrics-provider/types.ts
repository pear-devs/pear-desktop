import type { SongInfo } from '@/providers/song-info';
import type { ProviderName } from './providers';
import type { ProviderState } from './providers';

export type LyricsStore = {
  provider: ProviderName;
  current: ProviderState;
  lyrics: Record<ProviderName, ProviderState>;
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

export type SearchSongInfo = Pick<SongInfo, 'title' | 'alternativeTitle' | 'artist' | 'album' | 'songDuration' | 'videoId' | 'tags'>;

export interface LyricProvider {
  name: string;
  baseUrl: string;

  search(songInfo: SearchSongInfo): Promise<LyricResult | null>;
}

export interface LyricsProviderAPI {
  fetchLyrics: (song: SongInfo) => void;
  currentLyrics: () => ProviderState;
  lyricsStore: {
    provider: ProviderName;
    current: ProviderState;
    lyrics: Record<ProviderName, ProviderState>;
  };
  setLyricsStore: (path: string | string[], value: any) => void;
  retrySearch: (provider: ProviderName, song: SongInfo) => void;
}
