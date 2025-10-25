import { jaroWinkler } from '@skyra/jaro-winkler';
import { config } from '../renderer/renderer';
import { LRC } from '../parsers/lrc';

import type { LyricProvider, LyricResult, SearchSongInfo } from '../types';

export class SimpMusicLyrics implements LyricProvider {
  name = 'SimpMusicLyrics';
  baseUrl = 'https://api-lyrics.simpmusic.org/v1';

  async search({
    title,
    alternativeTitle,
    artist,
    album,
    songDuration,
    tags,
  }: SearchSongInfo): Promise<LyricResult | null> {
    let data: SimpMusicSong[] = [];

    let query = new URLSearchParams({ q: `${title} ${artist}` });
    let url = `${this.baseUrl}/search?${query.toString()}`;
    let response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP error (${response.statusText})`);
    }

    let json = (await response.json()) as SimpMusicResponse;
    data = json?.data ?? [];

    if (!data.length) {
      query = new URLSearchParams({ q: title });
      url = `${this.baseUrl}/search?${query.toString()}`;

      response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error (${response.statusText})`);
      }

      json = (await response.json()) as SimpMusicResponse;
      data = json?.data ?? [];
    }

    if (!data.length && alternativeTitle) {
      query = new URLSearchParams({ q: alternativeTitle });
      url = `${this.baseUrl}/search?${query.toString()}`;

      response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error (${response.statusText})`);
      }

      json = (await response.json()) as SimpMusicResponse;
      data = json?.data ?? [];
    }

    if (!Array.isArray(data) || data.length === 0) {
      if (config()?.showLyricsEvenIfInexact) {
        return null;
      }
      return null;
    }

    const filteredResults: SimpMusicSong[] = [];

    for (const item of data) {
      const { artistName } = item;
      const artists = artist.split(/[&,]/g).map((i) => i.trim());
      const itemArtists = artistName.split(/[&,]/g).map((i) => i.trim());

      const permutations: [string, string][] = [];
      for (const a of artists) {
        for (const b of itemArtists) {
          permutations.push([a.toLowerCase(), b.toLowerCase()]);
        }
      }

      const ratio = Math.max(...permutations.map(([x, y]) => jaroWinkler(x, y)));
      if (ratio < 0.85) continue;

      filteredResults.push(item);
    }

    if (!filteredResults.length) return null;

    filteredResults.sort(
      (a, b) =>
        Math.abs(a.durationSeconds - songDuration) -
        Math.abs(b.durationSeconds - songDuration),
    );

    const maxVote = Math.max(...filteredResults.map((r) => r.vote ?? 0));

    const topVoted = filteredResults.filter((r) => (r.vote ?? 0) === maxVote);

    const best = topVoted[0];

    if (!best) return null;

    if (Math.abs(best.durationSeconds - songDuration) > 15) {
      return null;
    }

    const raw = best.syncedLyrics;
    const plain = best.plainLyric;

    if (!raw && !plain) return null;

    return {
      title: best.songTitle,
      artists: best.artistName.split(/[&,]/g).map((a) => a.trim()),
      lines: raw
        ? LRC.parse(raw).lines.map((l) => ({
            ...l,
            status: 'upcoming' as const,
          }))
        : undefined,
      lyrics: plain,
    };
  }
}

type SimpMusicResponse = {
  type: string;
  data: SimpMusicSong[];
  success?: boolean;
};

type SimpMusicSong = {
  id: string;
  videoId?: string;
  songTitle: string;
  artistName: string;
  albumName?: string;
  durationSeconds: number;
  plainLyric?: string;
  syncedLyrics?: string;
  vote?: number;
};