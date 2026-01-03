import { jaroWinkler } from '@skyra/jaro-winkler';

import { config } from '../renderer/renderer';
import { LRC } from '../parsers/lrc';
import {
  ensureLeadingPaddingEmptyLine,
  ensureTrailingEmptyLine,
  mergeConsecutiveEmptySyncedLines,
} from '../shared/lines';

import type { LyricProvider, LyricResult, SearchSongInfo } from '../types';

export class LRCLib implements LyricProvider {
  name = 'LRCLib';
  baseUrl = 'https://lrclib.net';

  async search({
    title,
    alternativeTitle,
    artist,
    album,
    songDuration,
    tags,
  }: SearchSongInfo): Promise<LyricResult | null> {
    let query = new URLSearchParams({
      artist_name: artist,
      track_name: title,
    });

    query.set('album_name', album!);
    if (query.get('album_name') === 'undefined') {
      query.delete('album_name');
    }

    let url = `${this.baseUrl}/api/search?${query.toString()}`;
    let response = await fetch(url);

    if (!response.ok) {
      throw new Error(`bad HTTPStatus(${response.statusText})`);
    }

    let data = (await response.json()) as LRCLIBSearchResponse;
    if (!data || !Array.isArray(data)) {
      throw new Error(`Expected an array, instead got ${typeof data}`);
    }

    if (data.length === 0) {
      if (!config()?.showLyricsEvenIfInexact) {
        return null;
      }

      // Try to search with the alternative title (original language)
      const trackName = alternativeTitle || title;
      query = new URLSearchParams({ q: `${trackName}` });
      url = `${this.baseUrl}/api/search?${query.toString()}`;

      response = await fetch(url);
      if (!response.ok) {
        throw new Error(`bad HTTPStatus(${response.statusText})`);
      }

      data = (await response.json()) as LRCLIBSearchResponse;
      if (!Array.isArray(data)) {
        throw new Error(`Expected an array, instead got ${typeof data}`);
      }

      // If still no results, try with the original title as fallback
      if (data.length === 0 && alternativeTitle) {
        query = new URLSearchParams({ q: title });
        url = `${this.baseUrl}/api/search?${query.toString()}`;

        response = await fetch(url);
        if (!response.ok) {
          throw new Error(`bad HTTPStatus(${response.statusText})`);
        }

        data = (await response.json()) as LRCLIBSearchResponse;
        if (!Array.isArray(data)) {
          throw new Error(`Expected an array, instead got ${typeof data}`);
        }
      }
    }

    const filteredResults = [];
    const SIM_THRESHOLD = 0.9;
    for (const item of data) {
      // quick duration guard to avoid expensive similarity on far-off matches
      if (Math.abs(item.duration - songDuration) > 15) continue;
      if (item.instrumental) continue;

      const { artistName } = item;

      const artists = artist
        .split(/[&,]/g)
        .map((i) => i.trim().toLowerCase())
        .filter(Boolean);
      const itemArtists = artistName
        .split(/[&,]/g)
        .map((i) => i.trim().toLowerCase())
        .filter(Boolean);

      // fast path: any exact artist match
      let ratio = 0;
      if (artists.some((a) => itemArtists.includes(a))) {
        ratio = 1;
      } else {
        // compute best pairwise similarity with early exit
        outer: for (const a of artists) {
          for (const b of itemArtists) {
            const r = jaroWinkler(a, b);
            if (r > ratio) ratio = r;
            if (ratio >= 0.97) break outer; // good enough, stop early
          }
        }
      }

      // If direct artist match is below threshold and we have tags, compare tags too
      if (ratio <= SIM_THRESHOLD && tags && tags.length > 0) {
        const artistSet = new Set(artists);
        const filteredTags = Array.from(
          new Set(
            tags
              .map((t) => t.trim().toLowerCase())
              .filter((t) => t && !artistSet.has(t)),
          ),
        );

        outerTags: for (const t of filteredTags) {
          for (const b of itemArtists) {
            const r = jaroWinkler(t, b);
            if (r > ratio) ratio = r;
            if (ratio >= 0.97) break outerTags;
          }
        }
      }

      if (ratio <= SIM_THRESHOLD) continue;
      filteredResults.push(item);
    }

    filteredResults.sort(({ duration: durationA }, { duration: durationB }) => {
      const left = Math.abs(durationA - songDuration);
      const right = Math.abs(durationB - songDuration);

      return left - right;
    });

    const closestResult = filteredResults[0];
    if (!closestResult) {
      return null;
    }

    if (Math.abs(closestResult.duration - songDuration) > 15) {
      return null;
    }

    if (closestResult.instrumental) {
      return null;
    }

    const raw = closestResult.syncedLyrics;
    const plain = closestResult.plainLyrics;

    if (raw) {
      // Prefer synced
      const parsed = LRC.parse(raw).lines.map((l) => ({
        ...l,
        status: 'upcoming' as const,
      }));
      const merged = mergeConsecutiveEmptySyncedLines(parsed);
      const withLeading = ensureLeadingPaddingEmptyLine(merged, 300, 'span');
      const finalLines = ensureTrailingEmptyLine(
        withLeading,
        'midpoint',
        songDuration * 1000,
      );

      return {
        title: closestResult.trackName,
        artists: closestResult.artistName.split(/[&,]/g),
        lines: finalLines,
      };
    } else if (plain) {
      // Fallback to plain if no synced
      return {
        title: closestResult.trackName,
        artists: closestResult.artistName.split(/[&,]/g),
        lyrics: plain,
      };
    }

    return null;
  }
}

type LRCLIBSearchResponse = {
  id: number;
  name: string;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string;
  syncedLyrics: string;
}[];
