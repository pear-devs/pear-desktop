import {
  config,
  type ConfigOf,
  type DeepPartial,
} from '@/plugins/utils/common/config';

export const scrobblerConfig = {
  /**
   * Attempt to scrobble other video types (e.g. Podcasts, normal videos)
   */
  scrobbleOtherMedia: config.bool(true, {
    label: 'plugins.scrobbler.menu.scrobble-other-media',
  }),
  /**
   * Use alternative titles for scrobbling (Useful for non-roman song titles, e.g. (Not) A Devil -> デビルじゃないもん)
   */
  alternativeTitles: config.bool(true, {
    label: 'plugins.scrobbler.menu.scrobble-alternative-title',
  }),
  /**
   * Use alternative artist for scrobbling (e.g., DECO27 & (or) PinocchioP -> DECO27 / marasy -> まらしぃ)
   */
  alternativeArtist: config.bool(true, {
    label: 'plugins.scrobbler.menu.scrobble-alternative-artist',
  }),
  // The scrobbler submenus are built by the plugin's own menu.
  scrobblers: config.group({
    lastfm: config.group({
      /** Enable Last.fm scrobbling */
      enabled: config.bool(false),
      /** Token used for authentication */
      token: config.hidden<string | undefined>(undefined),
      /** Session key used for scrobbling */
      sessionKey: config.hidden<string | undefined>(undefined),
      /** Root of the Last.fm API */
      apiRoot: config.string('https://ws.audioscrobbler.com/2.0/'),
      /** Last.fm api key registered by @semvis123 */
      apiKey: config.string('04d76faaac8726e60988e14c105d421a'),
      /** Last.fm api secret registered by @semvis123 */
      secret: config.string('a5d2a36fdf64819290f6982481eaffa2'),
    }),
    listenbrainz: config.group({
      /** Enable ListenBrainz scrobbling */
      enabled: config.bool(false),
      /** Listenbrainz user token */
      token: config.hidden<string | undefined>(undefined),
      /** Root of the ListenBrainz API */
      apiRoot: config.string('https://api.listenbrainz.org/1/'),
    }),
  }),
};

export type ScrobblerPluginConfig = ConfigOf<typeof scrobblerConfig>;

export type SetConfType = (
  conf: DeepPartial<ScrobblerPluginConfig>,
) => void | Promise<void>;
