import type { LyricProvider, LyricResult, SearchSongInfo } from '../types';

const preloadedStateRegex = /__PRELOADED_STATE__ = JSON\.parse\('(.*?)'\);/;
const preloadHtmlRegex = /body":{"html":"(.*?)","children"/;

export class LyricsGenius implements LyricProvider {
  public name = 'Genius';
  public baseUrl = 'https://genius.com';
  private domParser = new DOMParser();

  // prettier-ignore
  async search({ title, artist }: SearchSongInfo): Promise<LyricResult | null> {
    const query = new URLSearchParams({
      q: `${artist} ${title}`,
      page: '1',
      per_page: '10',
    });

    const response = await fetch(`${this.baseUrl}/api/search/song?${query}`);
    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as LyricsGeniusSearch;
    const hits = data.response.sections[0].hits;

    hits.sort(
      ({
        result: {
          title: titleA,
          primary_artist: { name: artistA },
        },
      }, {
        result: {
          title: titleB,
          primary_artist: { name: artistB },
        },
      }) => {
        const pointsA = (titleA === title ? 1 : 0) +
          (artistA.includes(artist) ? 1 : 0);
        const pointsB = (titleB === title ? 1 : 0) +
          (artistB.includes(artist) ? 1 : 0);

        return pointsB - pointsA;
      },
    );

    const closestHit = hits.at(0);
    if (!closestHit || closestHit.result.primary_artist.url === 'https://genius.com/artists/Deleted-artist') {
      return null;
    }

    const { result: { path } } = closestHit;

    const html = await fetch(`${this.baseUrl}${path}`).then((res) =>
      res.text()
    );
    const doc = this.domParser.parseFromString(html, 'text/html');

    const preloadedStateScript = Array.prototype.find.call(
      doc.querySelectorAll('script'),
      (script: HTMLScriptElement) => {
        return script.textContent?.includes('window.__PRELOADED_STATE__');
      },
    ) as HTMLScriptElement;

    const preloadedState = preloadedStateScript.textContent?.match(
      preloadedStateRegex,
    )?.[1]?.replace(/\\"/g, '"');

    const lyricsHtml = preloadedState?.match(preloadHtmlRegex)?.[1]
      ?.replace(/\\\//g, '/')
      ?.replace(/\\\\/g, '\\')
      ?.replace(/\\n/g, '\n')
      ?.replace(/\\'/g, "'")
      ?.replace(/\\"/g, '"');

    const hasUnreleasedPlaceholder = preloadedState &&
      /lyricsPlaceholderReason.{1,5}unreleased/.test(preloadedState);
    if (!lyricsHtml) {
      if (hasUnreleasedPlaceholder) return null;
      throw new Error('Failed to extract lyrics from preloaded state.');
    }

    const lyricsDoc = this.domParser.parseFromString(lyricsHtml, 'text/html');
    const lyrics = lyricsDoc.body.innerText;

    if (lyrics.trim().toLowerCase().replace(/[[\]]/g, '') === 'instrumental') {
      return null;
    }

    return {
      title: closestHit.result.title,
      artists: closestHit.result.primary_artists.map(({ name }) => name),
      lyrics,
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
