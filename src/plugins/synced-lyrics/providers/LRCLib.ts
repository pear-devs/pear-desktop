import { jaroWinkler } from '@skyra/jaro-winkler';

import { LRC } from '../parsers/lrc';
import { netFetch } from '../renderer';
import { config } from '../renderer/renderer';

import type { LyricProvider, LyricResult, SearchSongInfo } from '../types';

const CLIENT_ID = 'Pear Desktop (https://github.com/pear-devs/pear-desktop)';
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const NOISE_TAG_PATTERN =
  /\s*[([](?:video\s+oficial|v[ií]deo\s+oficial|letra\s+oficial|video\s+musical|audio\s+oficial|lyric\s+video|official\s+[^)\]]*|visualizer)[)\]]/gi;
const ARTIST_SPLIT_PATTERN = /(?:\s+(?:feat\.?|ft\.?|y|and|with)\s+|[&,])/i;

const cleanTrackTitle = (rawTitle: string): string => {
  const cleaned = rawTitle
    .replace(NOISE_TAG_PATTERN, '')
    .split(' | ')[0]
    .trim();
  return cleaned || rawTitle;
};

const normalizeArtist = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

const splitArtists = (value: string): string[] => {
  const full = normalizeArtist(value);
  const parts = value
    .split(ARTIST_SPLIT_PATTERN)
    .map((part) => normalizeArtist(part))
    .filter(Boolean);
  return Array.from(new Set([full, ...parts].filter(Boolean)));
};

export class LRCLib implements LyricProvider {
  name = 'LRCLib';
  baseUrl = 'https://lrclib.net';

  private sleepWithJitter(baseDelayMs: number): Promise<void> {
    const jitter = Math.random() * 0.3;
    const scale = 1 + jitter;
    return new Promise((resolve) => {
      setTimeout(resolve, Math.round(baseDelayMs * scale));
    });
  }

  private async fetchSearch(
    q: string,
    maxAttempts = 4,
  ): Promise<LRCLIBSearchResponse> {
    const url = `${this.baseUrl}/api/search?${new URLSearchParams({ q }).toString()}`;
    let lastStatus = 0;
    let lastStatusText = '';

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let status: number;
      let statusText = '';
      let body: string;
      let retryAfterHeader: string | undefined;

      try {
        if (typeof netFetch === 'function') {
          const [resStatus, resBody, resHeaders] = await netFetch(url, {
            headers: {
              'Accept': 'application/json',
              'Lrclib-Client': CLIENT_ID,
              'User-Agent': CLIENT_ID,
            },
          });
          status = resStatus;
          body = resBody;
          retryAfterHeader = Object.entries(resHeaders).find(
            ([key]) => key.toLowerCase() === 'retry-after',
          )?.[1];
        } else {
          const response = await fetch(url, {
            headers: {
              'Accept': 'application/json',
              'Lrclib-Client': CLIENT_ID,
            },
          });
          status = response.status;
          statusText = response.statusText;
          body = await response.text();
          retryAfterHeader = response.headers.get('retry-after') ?? undefined;
        }
      } catch (error) {
        if (attempt === maxAttempts) throw error;
        await this.sleepWithJitter(1000 * attempt);
        continue;
      }

      if (status >= 200 && status < 300) {
        const parsed: unknown = JSON.parse(body);
        if (!Array.isArray(parsed)) {
          throw new Error(`Expected an array, instead got ${typeof parsed}`);
        }
        return parsed as LRCLIBSearchResponse;
      }

      lastStatus = status;
      lastStatusText = statusText;
      if (!RETRYABLE_STATUSES.has(status) || attempt === maxAttempts) break;

      const retryAfter = retryAfterHeader
        ? Number.parseInt(retryAfterHeader, 10)
        : Number.NaN;
      if (retryAfter > 10) break;

      const delayMs =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : 1000 * attempt;
      await this.sleepWithJitter(delayMs);
    }

    throw Object.assign(
      new Error(
        `bad HTTPStatus(${lastStatus}${lastStatusText ? ` ${lastStatusText}` : ''})`,
      ),
      { status: lastStatus },
    );
  }

  async search({
    title,
    alternativeTitle,
    artist,
    songDuration,
    tags,
  }: SearchSongInfo): Promise<LyricResult | null> {
    const allowInexact = Boolean(config()?.showLyricsEvenIfInexact);
    const cleanedTitle = cleanTrackTitle(title);
    const altCleaned = alternativeTitle
      ? cleanTrackTitle(alternativeTitle)
      : undefined;

    const candidateQueries = Array.from(
      new Set(
        (allowInexact
          ? [
              `${artist} ${cleanedTitle}`,
              `${artist} ${title}`,
              altCleaned,
              cleanedTitle,
              title,
            ]
          : [`${artist} ${cleanedTitle}`, `${artist} ${title}`]
        ).filter((q): q is string => Boolean(q?.trim())),
      ),
    );

    let data: LRCLIBSearchResponse = [];
    let lastError: Error | undefined;

    for (let i = 0; i < candidateQueries.length; i++) {
      const isLast = i === candidateQueries.length - 1;
      try {
        const res = await this.fetchSearch(candidateQueries[i], isLast ? 4 : 2);
        lastError = undefined;
        if (res.length > 0) {
          data = res;
          break;
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const status = (error as { status?: number }).status;
        if (isLast || status === 429 || status === 503) break;
      }
    }

    if (data.length === 0 && lastError) {
      throw lastError;
    }

    const filteredResults: LRCLIBSearchResponse = [];
    const artists = splitArtists(artist);

    for (const item of data) {
      if (item.instrumental || (!item.syncedLyrics && !item.plainLyrics)) {
        continue;
      }

      const itemArtists = splitArtists(item.artistName);

      // Try to match using artist name first
      const permutations: [string, string][] = [];
      for (const artistA of artists) {
        for (const artistB of itemArtists) {
          permutations.push([artistA, artistB]);
        }
      }

      let ratio = Math.max(
        0,
        ...permutations.map(([x, y]) => jaroWinkler(x, y)),
      );

      // If direct artist match is below threshold and we have tags, try matching with tags
      if (ratio <= 0.9 && tags && tags.length > 0) {
        // Filter out the artist from tags to avoid duplicate comparisons
        const filteredTags = tags
          .filter((tag) => tag.toLowerCase() !== artist.toLowerCase())
          .flatMap((tag) => splitArtists(tag));

        const tagPermutations: [string, string][] = [];
        // Compare each tag with each item artist
        for (const tag of filteredTags) {
          for (const itemArtist of itemArtists) {
            tagPermutations.push([tag, itemArtist]);
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

    filteredResults.sort((a, b) => {
      const left = Math.abs(a.duration - songDuration);
      const right = Math.abs(b.duration - songDuration);

      if (left <= 15 && right <= 15) {
        const aSynced = Boolean(a.syncedLyrics);
        const bSynced = Boolean(b.syncedLyrics);
        if (aSynced !== bSynced) return aSynced ? -1 : 1;
      }

      return left - right;
    });

    const closestResult = filteredResults[0];
    if (!closestResult) {
      return null;
    }

    if (Math.abs(closestResult.duration - songDuration) > 15) {
      return null;
    }

    const raw = closestResult.syncedLyrics;
    const plain = closestResult.plainLyrics;
    if (!raw && !plain) {
      return null;
    }

    return {
      title: closestResult.trackName,
      artists: closestResult.artistName
        .split(/[&,]|\s+(?:feat\.?|ft\.?)\s+/i)
        .map((i) => i.trim())
        .filter(Boolean),
      lines: raw
        ? LRC.parse(raw).lines.map((l) => ({
            ...l,
            status: 'upcoming' as const,
          }))
        : undefined,
      lyrics: plain ?? undefined,
    };
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
  plainLyrics: string | null;
  syncedLyrics: string | null;
}[];
