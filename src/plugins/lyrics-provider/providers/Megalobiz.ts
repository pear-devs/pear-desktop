import { jaroWinkler } from '@skyra/jaro-winkler';

import { LRC } from '../parsers/lrc';
import { netFetch } from '../renderer';

import type { LyricProvider, LyricResult, SearchSongInfo } from '../types';

const removeNoise = (text: string) => {
  return text
    .replace(/\[.*?\]/g, '')
    .replace(/\(.*?\)/g, '')
    .trim()
    .replace(/(^[-•])|([-•]$)/g, '')
    .trim()
    .replace(/\s+by$/, '');
};

export class Megalobiz implements LyricProvider {
  public name = 'Megalobiz';
  public baseUrl = 'https://www.megalobiz.com';
  private domParser = new DOMParser();

  // prettier-ignore
  async search({ title, artist, songDuration }: SearchSongInfo): Promise<LyricResult | null> {
    const query = new URLSearchParams({
      qry: `${artist} ${title}`,
    });

    const [status, data] = await netFetch(`${this.baseUrl}/search/all?${query}`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (status < 200 || status >= 300) {
      throw new Error(`bad HTTPStatus(${status})`);
    }

    const searchDoc = this.domParser.parseFromString(data, 'text/html');

    // prettier-ignore
    const searchResults: MegalobizSearchResult[] = Array.prototype.map
      .call(searchDoc.querySelectorAll('a.entity_name[href^="/lrc/maker/"][name][title]'),
        (anchor: HTMLAnchorElement) => {
          const { minutes, seconds, millis } = anchor
            .getAttribute('title')!
            .match(/\[(?<minutes>\d+):(?<seconds>\d+)\.(?<millis>\d+)\]/)!
            .groups!;

          let name = anchor.getAttribute('name')!;

          const artists = [
            removeNoise(name.match(/\(?[Ff]eat\. (.+)\)?/)?.[1] ?? ''),
            ...(removeNoise(name).match(/(?<artists>.*?) [-•] (?<title>.*)/)?.groups?.artists?.split(/[&,]/)?.map(removeNoise) ?? []),
            ...(removeNoise(name).match(/(?<title>.*) by (?<artists>.*)/)?.groups?.artists?.split(/[&,]/)?.map(removeNoise) ?? []),
          ].filter(Boolean);

          for (const artist of artists) {
            name = name.replace(artist, '');
            name = removeNoise(name);
          }

          if (jaroWinkler(title, name) < 0.8) return null;

          return {
            title: name,
            artists,
            href: anchor.getAttribute('href')!,
            duration:
              parseInt(minutes) * 60 +
              parseInt(seconds) +
              parseInt(millis) / 1000,
          };
        },
      )
      .filter(Boolean);

    const sortedResults = searchResults.sort(
      ({ duration: durationA }, { duration: durationB }) => {
        const left = Math.abs(durationA - songDuration);
        const right = Math.abs(durationB - songDuration);

        return left - right;
      },
    );

    const closestResult = sortedResults[0];
    if (!closestResult) return null;
    if (Math.abs(closestResult.duration - songDuration) > 15) {
      return null;
    }

    const [status2, html] = await netFetch(`${this.baseUrl}${closestResult.href}`);
    if (status2 < 200 || status2 >= 300) {
      throw new Error(`bad HTTPStatus(${status2})`);
    }
    const lyricsDoc = this.domParser.parseFromString(html, 'text/html');
    const raw = lyricsDoc.querySelector('span[id^="lrc_"][id$="_lyrics"]')?.textContent;
    if (!raw) throw new Error('Failed to extract lyrics from page.');

    const lyrics = LRC.parse(raw);

    return {
      title: closestResult.title,
      artists: closestResult.artists,
      lines: lyrics.lines.map((l) => ({ ...l, status: 'upcoming' })),
    };
  }
}

interface MegalobizSearchResult {
  title: string;
  artists: string[];
  href: string;
  duration: number;
}
