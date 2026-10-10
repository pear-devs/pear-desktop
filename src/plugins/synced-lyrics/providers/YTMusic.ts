import { normalizeLines } from '../domain';
import { bounded, lyricsHttp } from '../search/http';

import type {
  LyricProvider,
  LyricCandidate,
  SearchSongInfo,
  SearchContext,
} from '../types';
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
    { videoId, title, artist, songDuration }: SearchSongInfo,
    context?: SearchContext,
  ): Promise<LyricCandidate[]> {
    const data = await bounded(() => Promise.resolve(this.fetchNext(videoId)), context?.signal);
    context?.signal.throwIfAborted();

    const { tabs } =
      data?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer
        ?.watchNextTabbedResultsRenderer ?? {};
    if (!Array.isArray(tabs)) return [];

    const lyricsTab = tabs.find((it) => {
      const pageType = it?.tabRenderer?.endpoint?.browseEndpoint
        ?.browseEndpointContextSupportedConfigs
        ?.browseEndpointContextMusicConfig?.pageType;
      return pageType === 'MUSIC_PAGE_TYPE_TRACK_LYRICS';
    });

    if (!lyricsTab) return [];

    const { browseId } = lyricsTab?.tabRenderer?.endpoint?.browseEndpoint ?? {};
    if (!browseId) return [];

    const { contents } = await this.fetchBrowse(browseId, context?.signal);
    if (!contents) return [];

    /*
      NOTE: Due to the nature of the library, the json responses are not consistent,
            this means we have to check for multiple possible paths to get the lyrics.
    */

    const syncedLines = contents?.elementRenderer?.newElement?.type
      ?.componentType?.model?.timedLyricsModel?.lyricsData?.timedLyricsData;

    const synced = syncedLines?.length && syncedLines[0]?.cueRange
      ? normalizeLines(syncedLines.map((it) => ({
        startMs: Number(it.cueRange?.startTimeMilliseconds),
        endMs: Number(it.cueRange?.endTimeMilliseconds),
        text: it.lyricLine,
      })), songDuration * 1000)
      : undefined;

    const plain = !synced
      ? syncedLines?.length
        ? syncedLines.map((it) => it.lyricLine).join('\n')
        : contents?.messageRenderer
        ? contents?.messageRenderer?.text?.runs?.map((it) => it.text).join('\n')
        : contents?.sectionListRenderer?.contents?.[0]
          ?.musicDescriptionShelfRenderer?.description?.runs?.map((it) =>
            it.text,
          )?.join('\n')
      : undefined;

    if (typeof plain === 'string' && plain === 'Lyrics not available') {
      return [];
    }

    return [{
      provider: this.name, id: `${videoId}:${browseId}`, sourceId: browseId, exactVideoId: videoId,
      result: {
      title,
      artists: [artist],
      syncLevel: synced ? 'line' : 'plain',
      lyrics: plain,
      lines: synced,
      },
    }];
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

  private fetchBrowse(browseId: string, signal?: AbortSignal) {
    return lyricsHttp.json<BrowseData>(
      this.PROXIED_ENDPOINT + 'browse?prettyPrint=false',
      {
        signal,
        headers,
        method: 'POST',
        body: JSON.stringify({
          browseId,
          context: { client },
        }),
      },
    );
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
