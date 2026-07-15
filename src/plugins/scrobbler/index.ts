import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { backend } from './main';
import { onMenu } from './menu';

export interface ScrobblerPluginConfig {
  enabled: boolean;
  /**
   * Attempt to scrobble other video types (e.g. Podcasts, normal videos)
   *
   * @default true
   */
  scrobbleOtherMedia: boolean;
  /**
   * Use alternative titles for scrobbling (Useful for non-roman song titles, e.g. (Not) A Devil -> デビルじゃないもん)
   *
   * @default true
   */
  alternativeTitles: boolean;
  /**
   * Use alternative artist for scrobbling (e.g., DECO27 & (or) PinocchioP -> DECO27 / marasy -> まらしぃ)
   *
   * @default true
   */
  alternativeArtist: boolean;
  /**
   * Apply metadata cleanup (strip suffixes, custom regex) before scrobbling
   *
   * @default true
   */
  metadataCleanup: boolean;
  /**
   * Parse "Artist - Title" out of the title field when the artist is unreliable.
   * Off by default: it rewrites the artist for any title containing " - ".
   *
   * @default false
   */
  parseTitle: boolean;
  /**
   * Extra user-defined regex removed from title/artist/album (empty = disabled)
   *
   * @default ''
   */
  customRegex: string;
  scrobblers: {
    lastfm: {
      /**
       * Enable Last.fm scrobbling
       *
       * @default false
       */
      enabled: boolean;
      /**
       * Token used for authentication
       */
      token: string | undefined;
      /**
       * Session key used for scrobbling
       */
      sessionKey: string | undefined;
      /**
       * Root of the Last.fm API
       *
       * @default 'http://ws.audioscrobbler.com/2.0/'
       */
      apiRoot: string;
      /**
       * Last.fm api key registered by @semvis123
       *
       * @default '04d76faaac8726e60988e14c105d421a'
       */
      apiKey: string;
      /**
       * Last.fm api secret registered by @semvis123
       *
       * @default 'a5d2a36fdf64819290f6982481eaffa2'
       */
      secret: string;
      /**
       * Send "now playing" updates to Last.fm
       *
       * @default true
       */
      nowPlaying: boolean;
      /**
       * Skip scrobbling tracks shorter than this many seconds
       *
       * @default 30
       */
      minSongDuration: number;
      /**
       * Scrobble once this percentage of the track has played
       *
       * @default 50
       */
      delayPercent: number;
      /**
       * Scrobble at the latest after this many seconds
       *
       * @default 240
       */
      delaySeconds: number;
      /**
       * Love a track on Last.fm when it is liked in the player
       *
       * @default false
       */
      loveOnLike: boolean;
      /**
       * Immediately scrobble a track (bypassing the delay) when it is liked,
       * instead of waiting for the usual threshold. Only applies if
       * loveOnLike is enabled.
       *
       * @default false
       */
      forceScrobbleOnLike: boolean;
    };
    listenbrainz: {
      /**
       * Enable ListenBrainz scrobbling
       *
       * @default false
       */
      enabled: boolean;
      /**
       * Listenbrainz user token
       */
      token: string | undefined;
      /**
       * Root of the ListenBrainz API
       *
       * @default 'https://api.listenbrainz.org/1/'
       */
      apiRoot: string;
      /**
       * Send "playing now" updates to ListenBrainz
       *
       * @default true
       */
      nowPlaying: boolean;
      /**
       * Skip scrobbling tracks shorter than this many seconds
       *
       * @default 30
       */
      minSongDuration: number;
      /**
       * Scrobble once this percentage of the track has played
       *
       * @default 50
       */
      delayPercent: number;
      /**
       * Scrobble at the latest after this many seconds
       *
       * @default 240
       */
      delaySeconds: number;
      /**
       * Submit positive feedback to ListenBrainz when a track is liked in the
       * player. Liking a track this way always forces an immediate scrobble,
       * since feedback requires the track to have already been scrobbled.
       *
       * @default false
       */
      loveOnLike: boolean;
    };
  };
}

export const defaultConfig: ScrobblerPluginConfig = {
  enabled: false,
  scrobbleOtherMedia: true,
  alternativeTitles: true,
  alternativeArtist: true,
  metadataCleanup: true,
  parseTitle: false,
  customRegex: '',
  scrobblers: {
    lastfm: {
      enabled: false,
      token: undefined,
      sessionKey: undefined,
      apiRoot: 'https://ws.audioscrobbler.com/2.0/',
      apiKey: '04d76faaac8726e60988e14c105d421a',
      secret: 'a5d2a36fdf64819290f6982481eaffa2',
      nowPlaying: true,
      minSongDuration: 30,
      delayPercent: 50,
      delaySeconds: 240,
      loveOnLike: false,
      forceScrobbleOnLike: false,
    },
    listenbrainz: {
      enabled: false,
      token: undefined,
      apiRoot: 'https://api.listenbrainz.org/1/',
      nowPlaying: true,
      minSongDuration: 30,
      delayPercent: 50,
      delaySeconds: 240,
      loveOnLike: false,
    },
  },
};

export default createPlugin({
  name: () => t('plugins.scrobbler.name'),
  description: () => t('plugins.scrobbler.description'),
  restartNeeded: true,
  config: defaultConfig,
  menu: onMenu,
  backend,
});
