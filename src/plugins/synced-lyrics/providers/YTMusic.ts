import {
  ensureLeadingPaddingEmptyLine,
  ensureTrailingEmptyLine,
  mergeConsecutiveEmptySyncedLines,
} from '../shared/lines';

import type { LyricProvider, LyricResult, SearchSongInfo } from '../types';
import type { MusicPlayerAppElement } from '@/types/music-player-app-element';

const headers = {
  'Accept': 'application/json',
  'Content-Type': 'application/json',
};

const client = {
  clientName: '26',
  clientVersion: '7.01.05',
};

export class YTMusic implements LyricProvider {
  public name = 'YTMusic';
  public baseUrl =
    'https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/';

  // prettier-ignore
  public async search(
    { videoId, title, artist }: SearchSongInfo,
  ): Promise<LyricResult | null> {
    const data = await this.fetchNext(videoId);

    const { tabs } =
      data?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer
        ?.watchNextTabbedResultsRenderer ?? {};
    if (!Array.isArray(tabs)) return null;

    const lyricsTab = tabs.find((it) => {
      const pageType = it?.tabRenderer?.endpoint?.browseEndpoint
        ?.browseEndpointContextSupportedConfigs
        ?.browseEndpointContextMusicConfig?.pageType;
      return pageType === 'MUSIC_PAGE_TYPE_TRACK_LYRICS';
    });

    if (!lyricsTab) return null;

    const { browseId } = lyricsTab?.tabRenderer?.endpoint?.browseEndpoint ?? {};
    if (!browseId) return null;

    const { contents } = await this.fetchBrowse(browseId);
    if (!contents) return null;

    /*
      NOTE: Due to the nature of the library, the json responses are not consistent,
            this means we have to check for multiple possible paths to get the lyrics.
    */

    const syncedLines = contents?.elementRenderer?.newElement?.type
      ?.componentType?.model?.timedLyricsModel?.lyricsData?.timedLyricsData;

    const synced = syncedLines?.length && syncedLines[0]?.cueRange
      ? syncedLines.map((it) => ({
          time: this.millisToTime(parseInt(it.cueRange.startTimeMilliseconds)),
          timeInMs: parseInt(it.cueRange.startTimeMilliseconds),
          duration:
            parseInt(it.cueRange.endTimeMilliseconds) -
            parseInt(it.cueRange.startTimeMilliseconds),
          text: it.lyricLine.trim() === '♪' ? '' : it.lyricLine.trim(),
          status: 'upcoming' as const,
        }))
      : undefined;

    const plain = !synced
      ? syncedLines?.length
        ? syncedLines.map((it) => it.lyricLine).join('\n')
        : contents?.messageRenderer
        ? contents?.messageRenderer?.text?.runs?.map((it) => it.text).join('\n')
        : contents?.sectionListRenderer?.contents?.[0]
          ?.musicDescriptionShelfRenderer?.description?.runs
          ?.map((it) => it.text)
          ?.join('\n')
      : undefined;

    if (typeof plain === 'string' && plain === 'Lyrics not available') {
      return null;
    }

    const processed = synced
      ? (() => {
          const merged = mergeConsecutiveEmptySyncedLines(synced);
          const withLeading = ensureLeadingPaddingEmptyLine(merged, 300, 'span');
          return ensureTrailingEmptyLine(withLeading, 'lastEnd');
        })()
      : undefined;

    return {
      title,
      artists: [artist],

      lyrics: plain,
      lines: processed,
    };
  }

  private millisToTime(millis: number) {
    const minutes = Math.floor(millis / 60000);
    const seconds = Math.floor((millis % 60000) / 1000);
    const centiseconds = Math.floor((millis % 1000) / 10);

    return `${minutes.toString().padStart(2, '0')}:${seconds
      .toString()
      .padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`;
  }

  // RATE LIMITED (2 req per sec)
  private PROXIED_ENDPOINT = 'https://ytmbrowseproxy.zvz.be/';

  private fetchNext(videoId: string) {
    const app = document.querySelector<MusicPlayerAppElement>('ytmusic-app');

    if (!app) return null;

    return app.networkManager.fetch<
      NextData,
      {
        videoId: string;
      }
    >('/next?prettyPrint=false', {
      videoId,
    });
  }

  private fetchBrowse(browseId: string) {
    return fetch(this.PROXIED_ENDPOINT + 'browse?prettyPrint=false', {
      headers,
      method: 'POST',
      body: JSON.stringify({
        browseId,
        context: { client },
      }),
    }).then((res) => res.json()) as Promise<BrowseData>;
  }
}

interface NextData {
  contents: {
    singleColumnMusicWatchNextResultsRenderer: {
      tabbedRenderer: {
        watchNextTabbedResultsRenderer: {
          tabs: {
            tabRenderer: {
              endpoint: {
                browseEndpoint: {
                  browseId: string;
                  browseEndpointContextSupportedConfigs: {
                    browseEndpointContextMusicConfig: {
                      pageType: string;
                    };
                  };
                };
              };
            };
          }[];
        };
      };
    };
  };
}

interface BrowseData {
  contents: {
    elementRenderer: {
      newElement: {
        type: {
          componentType: {
            model: {
              timedLyricsModel: {
                lyricsData: {
                  timedLyricsData: SyncedLyricLine[];
                };
              };
            };
          };
        };
      };
    };
    messageRenderer: {
      text: PlainLyricsTextRenderer;
    };
    sectionListRenderer: {
      contents: {
        musicDescriptionShelfRenderer: {
          description: PlainLyricsTextRenderer;
        };
      }[];
    };
  };
}

interface SyncedLyricLine {
  lyricLine: string;
  cueRange: CueRange;
}

interface CueRange {
  startTimeMilliseconds: string;
  endTimeMilliseconds: string;
}

interface PlainLyricsTextRenderer {
  runs: {
    text: string;
  }[];
}
