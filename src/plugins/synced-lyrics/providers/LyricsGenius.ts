import { lyricsHttp, LyricsError } from '../search/http';

import type {
  LyricProvider,
  LyricCandidate,
  SearchSongInfo,
  SearchContext,
} from '../types';

const preloadedStateRegex = /__PRELOADED_STATE__ = JSON\.parse\('(.*?)'\);/;
const preloadHtmlRegex = /body":{"html":"(.*?)","children"/;

export class LyricsGenius implements LyricProvider {
  public name = 'LyricsGenius';
  public baseUrl = 'https://genius.com';
  private domParser = new DOMParser();

  // prettier-ignore
  async search({ title, artist }: SearchSongInfo, context?: SearchContext): Promise<LyricCandidate[]> {
    const query = new URLSearchParams({
      q: `${artist} ${title}`,
      page: '1',
      per_page: '10',
    });

    const data = await lyricsHttp.json<LyricsGeniusSearch>(`${this.baseUrl}/api/search/song?${query}`, { signal: context?.signal });
    const hits = data.response?.sections?.[0]?.hits;
    if (!Array.isArray(hits)) return [];
    const sources = hits.map(({ result }) => result).filter((source, index, all) =>
      source.primary_artist.url !== 'https://genius.com/artists/Deleted-artist' && all.findIndex((other) => other.id === source.id) === index);
    const settled = await Promise.allSettled(sources.map((source) => this.fetchCandidate(source, context?.signal)));
    context?.signal.throwIfAborted();
    const candidates = settled.flatMap((item) => item.status === 'fulfilled' && item.value ? [item.value] : []);
    const failed = settled.filter((item) => item.status === 'rejected');
    if (!candidates.length && failed.length) throw failed[0].reason;
    for (const failure of failed) console.warn('Genius candidate retrieval failed', failure.reason);
    return candidates;
  }

  private async fetchCandidate(
    source: Result,
    signal?: AbortSignal,
  ): Promise<LyricCandidate | null> {
    const { path } = source;

    let html: string;
    try {
      html = await lyricsHttp.text(`${this.baseUrl}${path}`, { signal });
    } catch (error) {
      if (error instanceof LyricsError && error.status === 404) return null;
      throw error;
    }
    const doc = this.domParser.parseFromString(html, 'text/html');

    const preloadedStateScript = Array.prototype.find.call(
      doc.querySelectorAll('script'),
      (script: HTMLScriptElement) => {
        return script.textContent?.includes('window.__PRELOADED_STATE__');
      },
    ) as HTMLScriptElement;

    const preloadedState = preloadedStateScript?.textContent
      ?.match(preloadedStateRegex)?.[1]
      ?.replace(/\\"/g, '"');

    const lyricsHtml = preloadedState
      ?.match(preloadHtmlRegex)?.[1]
      ?.replace(/\\\//g, '/')
      ?.replace(/\\\\/g, '\\')
      ?.replace(/\\n/g, '\n')
      ?.replace(/\\'/g, "'")
      ?.replace(/\\"/g, '"');

    const hasUnreleasedPlaceholder =
      preloadedState &&
      /lyricsPlaceholderReason.{1,5}unreleased/.test(preloadedState);
    if (!lyricsHtml) {
      if (hasUnreleasedPlaceholder) return null;
      return null;
    }

    const lyricsDoc = this.domParser.parseFromString(lyricsHtml, 'text/html');
    const lyrics = lyricsDoc.body.innerText;

    if (lyrics.trim().toLowerCase().replace(/[[\]]/g, '') === 'instrumental') {
      return null;
    }

    return {
      provider: this.name,
      id: String(source.id),
      sourceId: String(source.id),
      result: {
        title: source.title,
        artists: source.primary_artists.map(({ name }) => name),
        syncLevel: 'plain',
        lyrics,
      },
    };
  }
}

interface LyricsGeniusSearch {
  response: Response;
}

interface Response {
  sections: Section[];
}

interface Section {
  hits: {
    highlights: unknown[];
    index: string;
    type: string;
    result: Result;
  }[];
}

interface Result {
  api_path: string;
  artist_names: string;
  full_title: string;
  id: number;
  instrumental: boolean;
  path: string;
  release_date_components: ReleaseDateComponents;
  title: string;
  title_with_featured: string;
  updated_by_human_at: number;
  url: string;
  featured_artists: Artist[];
  primary_artist: Artist;
  primary_artists: Artist[];
}

interface Artist {
  api_path: string;
  id: number;
  image_url: string;
  name: string;
  slug: string;
  url: string;
}

interface ReleaseDateComponents {
  year: number;
  month: number;
  day: number;
}
