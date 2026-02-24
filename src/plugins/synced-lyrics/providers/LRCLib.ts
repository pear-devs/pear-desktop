import { jaroWinkler } from '@skyra/jaro-winkler';

import { config } from '../renderer/renderer';
import { LRC } from '../parsers/lrc';

import type { LyricProvider, LyricResult, SearchSongInfo } from '../types';

export class LRCLib implements LyricProvider {
  name = 'LRCLib';
  baseUrl = 'https://lrclib.net';

  async searchLyrics(query: URLSearchParams): Promise<LRCLIBSearchResponse> {
    const response = await fetch(
      `${this.baseUrl}/api/search?${query.toString()}`,
    );

    if (!response.ok) {
      throw new Error(`bad HTTPStatus(${response.statusText})`);
    }

    const data = (await response.json()) as LRCLIBSearchResponse;
    if (!data || !Array.isArray(data)) {
      throw new Error(`Expected an array, instead got ${typeof data}`);
    }
    return data;
  }

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
    const queries = [query];

    const trackName = alternativeTitle || title;
    let alternativeArtist = trackName.split(' - ')[0];
    alternativeArtist =
      alternativeArtist !== trackName ? alternativeArtist : '';

    if (config()?.showLyricsEvenIfInexact) {
      // Try to search with the alternative title (original language)
      query = new URLSearchParams({ q: `${trackName}` });
      queries.push(query);

      if (alternativeTitle) {
        // If still no results, try with the original title as fallback
        query = new URLSearchParams({ q: title });
        queries.push(query);
      }
    }

    let filteredResults: LRCLIBSearchResponse = [];
    const artists = artist.split(/[&,]/g).map((i) => i.trim());
    if (alternativeArtist !== '') {
      artists.push(alternativeArtist);
    }

    for (const query of queries) {
      const data = await this.searchLyrics(query);
      if (data.length == 0) continue;

      for (const item of data) {
        const { artistName } = item;
        const itemArtists = artistName.split(/[&,]/g).map((i) => i.trim());

        // Try to match using artist name first
        const permutations = [];
        for (const artistA of artists) {
          for (const artistB of itemArtists) {
            permutations.push([artistA.toLowerCase(), artistB.toLowerCase()]);
          }
        }

        for (const artistA of itemArtists) {
          for (const artistB of artists) {
            permutations.push([artistA.toLowerCase(), artistB.toLowerCase()]);
          }
        }

        let ratio = Math.max(
          ...permutations.map(([x, y]) => jaroWinkler(x, y)),
        );

        // If direct artist match is below threshold, and we have tags, try matching with tags
        if (ratio <= 0.9 && tags && tags.length > 0) {
          // Filter out the artist from tags to avoid duplicate comparisons
          const filteredTags = tags.filter(
            (tag) => tag.toLowerCase() !== artist.toLowerCase(),
          );

          const tagPermutations = [];
          // Compare each tag with each item artist
          for (const tag of filteredTags) {
            for (const itemArtist of itemArtists) {
              tagPermutations.push([
                tag.toLowerCase(),
                itemArtist.toLowerCase(),
              ]);
            }
          }

          // Compare each item artist with each tag
          for (const itemArtist of itemArtists) {
            for (const tag of filteredTags) {
              tagPermutations.push([
                itemArtist.toLowerCase(),
                tag.toLowerCase(),
              ]);
            }
          }

          if (tagPermutations.length > 0) {
            const tagRatio = Math.max(
              ...tagPermutations.map(([x, y]) => jaroWinkler(x, y)),
            );

            // Use the best match ratio between direct artist match and tag match
            ratio = Math.max(ratio, tagRatio);
          }
        }

        if (ratio <= 0.9) continue;
        filteredResults.push(item);
      }

      filteredResults = filteredResults.map((lrc) => {
        if (album) {
          lrc.albumRatio = jaroWinkler(
            lrc.albumName.toLowerCase(),
            album.toLowerCase(),
          );
        } else {
          lrc.albumRatio = 0;
        }

        return lrc;
      });

      filteredResults = filteredResults.filter((lrc) => {
        return Math.abs(lrc.duration - songDuration) < 15;
      });

      if (filteredResults.length == 0) continue;

      filteredResults.sort(
        (
          { duration: durationA, syncedLyrics: lyricsA, albumRatio: arA },
          { duration: durationB, syncedLyrics: lyricsB, albumRatio: arB },
        ) => {
          const hasLyricsA = lyricsA != null && lyricsA !== '';
          const hasLyricsB = lyricsB != null && lyricsB !== '';

          if (hasLyricsA !== hasLyricsB) {
            return hasLyricsB ? 1 : -1;
          }
          const durationDiffA = Math.abs(durationA - songDuration);
          const durationDiffB = Math.abs(durationB - songDuration);

          const normalizedDurationA = durationDiffA / songDuration;
          const normalizedDurationB = durationDiffB / songDuration;

          const weightAlbumRatio = 0.7;
          const weightDuration = 0.3;

          const scoreA =
            weightAlbumRatio * arA! - weightDuration * normalizedDurationA;
          const scoreB =
            weightAlbumRatio * arB! - weightDuration * normalizedDurationB;

          // Mayor score es mejor
          return scoreB - scoreA;
        },
      );

      const closestResult = filteredResults[0];

      if (closestResult.instrumental) {
        return null;
      }

      const raw = closestResult.syncedLyrics;
      const plain = closestResult.plainLyrics;
      if (!raw && !plain) {
        continue;
      }

      return {
        title: closestResult.trackName,
        artists: closestResult.artistName.split(/[&,]/g),
        lines: raw
          ? LRC.parse(raw).lines.map((l) => ({
              ...l,
              status: 'upcoming' as const,
            }))
          : undefined,
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
  albumRatio?: number;
}[];
