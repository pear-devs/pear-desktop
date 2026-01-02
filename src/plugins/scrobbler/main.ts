import { type BrowserWindow } from 'electron';

import {
  registerCallback,
  MediaType,
  type SongInfo,
  SongInfoEvent,
} from '@/providers/song-info';
import { createBackend } from '@/utils';

import { LastFmScrobbler } from './services/lastfm';
import { ListenbrainzScrobbler } from './services/listenbrainz';

import type { ScrobblerPluginConfig } from './index';
import type { ScrobblerBase } from './services/base';

export type SetConfType = (
  conf: Partial<Omit<ScrobblerPluginConfig, 'enabled'>>,
) => void | Promise<void>;

export const backend = createBackend<
  {
    config?: ScrobblerPluginConfig;
    window?: BrowserWindow;
    enabledScrobblers: Map<string, ScrobblerBase>;
    toggleScrobblers(
      config: ScrobblerPluginConfig,
      window: BrowserWindow,
    ): void;
    createSessions(
      config: ScrobblerPluginConfig,
      setConfig: SetConfType,
    ): Promise<void>;
    setConfig?: SetConfType;
  },
  ScrobblerPluginConfig
>({
  enabledScrobblers: new Map(),

  toggleScrobblers(config: ScrobblerPluginConfig, window: BrowserWindow) {
    if (config.scrobblers.lastfm && config.scrobblers.lastfm.enabled) {
      this.enabledScrobblers.set('lastfm', new LastFmScrobbler(window));
    } else {
      this.enabledScrobblers.delete('lastfm');
    }

    if (
      config.scrobblers.listenbrainz &&
      config.scrobblers.listenbrainz.enabled
    ) {
      this.enabledScrobblers.set('listenbrainz', new ListenbrainzScrobbler());
    } else {
      this.enabledScrobblers.delete('listenbrainz');
    }
  },

  async createSessions(config: ScrobblerPluginConfig, setConfig: SetConfType) {
    for (const [, scrobbler] of this.enabledScrobblers) {
      if (!scrobbler.isSessionCreated(config)) {
        await scrobbler.createSession(config, setConfig);
      }
    }
  },

  async start({ getConfig, setConfig, window }) {
    const config = (this.config = await getConfig());
    // This will store the timeout that will trigger addScrobble
    let scrobbleTimer: NodeJS.Timeout | undefined;

    this.window = window;
    this.toggleScrobblers(config, window);
    await this.createSessions(config, setConfig);
    this.setConfig = setConfig;

    registerCallback((songInfo: SongInfo, event) => {
      if (event === SongInfoEvent.TimeChanged) return;
      // Set remove the old scrobble timer
      clearTimeout(scrobbleTimer);
      if (!songInfo.isPaused) {
        const configNonnull = this.config!;
        // Scrobblers normally have no trouble working with official music videos
        if (
          !configNonnull.scrobbleOtherMedia &&
          songInfo.mediaType !== MediaType.Audio &&
          songInfo.mediaType !== MediaType.OriginalMusicVideo
        ) {
          return;
        }

        // Scrobble when the song is halfway through, or has passed the 4-minute mark
        const scrobbleTime = Math.min(
          Math.ceil(songInfo.songDuration / 2),
          4 * 60,
        );
        if (scrobbleTime > (songInfo.elapsedSeconds ?? 0)) {
          // Scrobble still needs to happen
          const timeToWait =
            (scrobbleTime - (songInfo.elapsedSeconds ?? 0)) * 1000;
          scrobbleTimer = setTimeout(
            (info, config) => {
              this.enabledScrobblers.forEach((scrobbler) =>
                scrobbler.addScrobble(info, config, setConfig),
              );
            },
            timeToWait,
            songInfo,
            configNonnull,
          );
        }

        this.enabledScrobblers.forEach((scrobbler) =>
          scrobbler.setNowPlaying(songInfo, configNonnull, setConfig),
        );
      }
    });
  },

  async onConfigChange(newConfig: ScrobblerPluginConfig) {
    this.enabledScrobblers.clear();

    this.toggleScrobblers(newConfig, this.window!);
    for (const [scrobblerName, scrobblerConfig] of Object.entries(
      newConfig.scrobblers,
    )) {
      if (scrobblerConfig.enabled) {
        const scrobbler = this.enabledScrobblers.get(scrobblerName);
        if (
          this.config?.scrobblers?.[
            scrobblerName as keyof typeof newConfig.scrobblers
          ]?.enabled !== scrobblerConfig.enabled &&
          scrobbler &&
          !scrobbler.isSessionCreated(newConfig) &&
          this.setConfig
        ) {
          await scrobbler.createSession(newConfig, this.setConfig);
        }
      }
    }

    this.config = newConfig;
  },
});
