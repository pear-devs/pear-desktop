import { LRC } from '../parsers/lrc';
import { lyricsHttp } from '../search/http';

import type {
  LyricProvider,
  LyricCandidate,
  SearchSongInfo,
  SearchContext,
} from '../types';

const removeNoise = (text: string) => {
  return text
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
  async search({ title, artist }: SearchSongInfo, context?: SearchContext): Promise<LyricCandidate[]> {
    const query = new URLSearchParams({
      qry: `${artist} ${title}`,
    });

    const data = await lyricsHttp.text(`${this.baseUrl}/search/all?${query}`, { signal: context?.signal, timeoutMs: 5000 });
    const searchDoc = this.domParser.parseFromString(data, 'text/html');

    // prettier-ignore
    const searchResults: MegalobizSearchResult[] = Array.prototype.map
        .call(searchDoc.querySelectorAll('a.entity_name[href^="/lrc/maker/"][name][title]'),
          (anchor: HTMLAnchorElement) => {
          const duration = anchor
            .getAttribute('title')
            ?.match(/\[(?<minutes>\d+):(?<seconds>\d+)\.(?<millis>\d+)\]/)
            ?.groups;
          const href = anchor.getAttribute('href');
          const nameAttribute = anchor.getAttribute('name');
          if (!duration || !href || !nameAttribute) return null;

          const { minutes, seconds, millis } = duration;

          let name = nameAttribute;

          const artists = [
            removeNoise(name.match(/\(?[Ff]eat\. (.+)\)?/)?.[1] ?? ''),
            ...(removeNoise(name).match(/(?<artists>.*?) [-•] (?<title>.*)/)?.groups?.artists?.split(/[&,]/)?.map(removeNoise) ?? []),
            ...(removeNoise(name).match(/(?<title>.*) by (?<artists>.*)/)?.groups?.artists?.split(/[&,]/)?.map(removeNoise) ?? []),
          ].filter(Boolean);

          for (const artist of artists) {
            name = name.replace(artist, '');
            name = removeNoise(name);
          }


          return {
            title: name,
            artists,
            href,
            duration:
              (parseInt(minutes) * 60) +
              parseInt(seconds) +
              (parseInt(millis) / 1000),
          };
        },
      )
      .filter(Boolean);

    return Promise.all(searchResults.map(async (source): Promise<LyricCandidate | null> => {
    const html = await lyricsHttp.text(`${this.baseUrl}${source.href}`, { signal: context?.signal, timeoutMs: 5000 });
    const lyricsDoc = this.domParser.parseFromString(html, 'text/html');
    const raw = lyricsDoc.querySelector('span[id^="lrc_"][id$="_lyrics"]')?.textContent;
    if (!raw) return null;

    const lyrics = LRC.parse(raw, source.duration * 1000);

    return {
      provider: this.name, id: source.href, sourceId: source.href, durationMs: source.duration * 1000,
      result: {
      title: source.title,
      artists: source.artists,
      syncLevel: lyrics.syncLevel,
      lines: lyrics.lines,
      },
    };
    })).then((candidates) => candidates.filter((candidate): candidate is LyricCandidate => candidate !== null));
  }
}

interface MegalobizSearchResult {
  title: string;
  artists: string[];
  href: string;
  duration: number;
}
