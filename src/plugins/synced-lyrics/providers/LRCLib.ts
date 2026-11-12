import { LRC } from '../parsers/lrc';
import { electronTransport } from '../search/electron-transport';
import { lyricsHttp, LyricsError } from '../search/http';

import type {
  LyricProvider,
  LyricCandidate,
  SearchSongInfo,
  SearchContext,
} from '../types';

export class LRCLib implements LyricProvider {
  name = 'LRCLib';
  baseUrl = 'https://lrclib.net';

  async search(
    { title, alternativeTitle, artist, album }: SearchSongInfo,
    context?: SearchContext,
  ): Promise<LyricCandidate[]> {
    const query = new URLSearchParams({
      artist_name: artist,
      track_name: title,
    });
    if (album) query.set('album_name', album);
    let data = await fetchSearch(
      `${this.baseUrl}/api/search?${query}`,
      context?.signal,
    );
    // Retrieval fallback, not acceptance policy. Common matcher decides inexactness.
    if (!data.length) {
      data = await fetchSearch(
        `${this.baseUrl}/api/search?${new URLSearchParams({ q: alternativeTitle || title })}`,
        context?.signal,
      );
      if (!data.length && alternativeTitle)
        data = await fetchSearch(
          `${this.baseUrl}/api/search?${new URLSearchParams({ q: title })}`,
          context?.signal,
        );
    }
    const seen = new Set<number>();
    return data.flatMap((item): LyricCandidate[] => {
      if (seen.has(item.id)) return [];
      seen.add(item.id);
      const synced = item.syncedLyrics
        ? LRC.parse(item.syncedLyrics, item.duration * 1000)
        : undefined;
      return [
        {
          provider: this.name,
          id: String(item.id),
          sourceId: String(item.id),
          album: item.albumName,
          durationMs: item.duration * 1000,
          ...(item.instrumental ? { variant: 'instrumental' } : {}),
          result: {
            title: item.trackName,
            artists: item.artistName.split(/[&,]/g).map((name) => name.trim()),
            syncLevel: synced?.syncLevel ?? 'plain',
            lines: synced?.lines,
            lyrics: item.plainLyrics ?? undefined,
          },
        },
      ];
    });
  }
}

async function fetchSearch(
  url: string,
  signal?: AbortSignal,
): Promise<LRCLIBSearchResponse> {
  try {
    return await lyricsHttp.json(
      url,
      {
        signal,
        transport: electronTransport,
        retries: 2,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'YouTube Music Desktop/3.12.0 (pear-desktop)',
        },
      },
      (data) => {
        if (
          !Array.isArray(data) ||
          !data.every((item: unknown) => {
            if (!item || typeof item !== 'object') return false;
            const value = item as Record<string, unknown>;
            return (
              typeof value.id === 'number' &&
              Number.isFinite(value.id) &&
              typeof value.trackName === 'string' &&
              typeof value.artistName === 'string' &&
              (value.albumName === undefined ||
                typeof value.albumName === 'string') &&
              typeof value.duration === 'number' &&
              Number.isFinite(value.duration * 1000) &&
              value.duration >= 0 &&
              (value.syncedLyrics == null ||
                typeof value.syncedLyrics === 'string') &&
              (value.plainLyrics == null ||
                typeof value.plainLyrics === 'string')
            );
          })
        )
          throw new Error('Invalid LRCLib search response');
        return data as LRCLIBSearchResponse;
      },
    );
  } catch (error) {
    if (error instanceof LyricsError && error.status === 404) return [];
    throw error;
  }
}

type LRCLIBSearchResponse = {
  id: number;
  trackName: string;
  artistName: string;
  albumName?: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}[];
