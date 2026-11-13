import { MediaType, SongInfoEvent } from '@/providers/song-info';
import { createBackend } from '@/utils';

import { LastFmScrobbler } from './services/lastfm';
import { ListenbrainzScrobbler } from './services/listenbrainz';

import type { ScrobblerBase } from './services/base';
import type {
  ScrobblerPluginConfig,
  scrobblerConfig,
  SetConfType,
} from './types';

export default createBackend<typeof scrobblerConfig>(async (ctx) => {
  const { window } = ctx;
  const enabledScrobblers = new Map<string, ScrobblerBase>();
  // The services mutate the config they get and save it whole.
  const currentConfig = (): ScrobblerPluginConfig =>
    structuredClone(ctx.config) as ScrobblerPluginConfig;
  const setConfig: SetConfType = (conf) => ctx.setConfig(conf);

  const toggleScrobblers = (config: Readonly<ScrobblerPluginConfig>) => {
    if (config.scrobblers.lastfm.enabled) {
      enabledScrobblers.set('lastfm', new LastFmScrobbler(window));
    } else {
      enabledScrobblers.delete('lastfm');
    }

    if (config.scrobblers.listenbrainz.enabled) {
      enabledScrobblers.set('listenbrainz', new ListenbrainzScrobbler());
    } else {
      enabledScrobblers.delete('listenbrainz');
    }
  };

  const createSessions = async () => {
    for (const [, scrobbler] of enabledScrobblers) {
      const config = currentConfig();
      if (!scrobbler.isSessionCreated(config)) {
        await scrobbler.createSession(config, setConfig);
      }
    }
  };

  toggleScrobblers(ctx.config);
  await createSessions();

  // This will store the timeout that will trigger addScrobble
  let scrobbleTimer: ReturnType<typeof setTimeout> | undefined;

  ctx.onSongInfo((songInfo, event) => {
    if (event === SongInfoEvent.TimeChanged) return;
    // Set remove the old scrobble timer
    ctx.clearTimeout(scrobbleTimer);
    if (!songInfo.isPaused) {
      const config = currentConfig();
      // Scrobblers normally have no trouble working with official music videos
      if (
        !config.scrobbleOtherMedia &&
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
        scrobbleTimer = ctx.setTimeout(() => {
          enabledScrobblers.forEach((scrobbler) =>
            scrobbler.addScrobble(songInfo, config, setConfig),
          );
        }, timeToWait);
      }

      enabledScrobblers.forEach((scrobbler) =>
        scrobbler.setNowPlaying(songInfo, config, setConfig),
      );
    }
  });

  ctx.onConfigChange(async (newConfig, previous) => {
    enabledScrobblers.clear();
    toggleScrobblers(newConfig);

    for (const [scrobblerName, scrobblerConfig] of Object.entries(
      newConfig.scrobblers,
    )) {
      if (!scrobblerConfig.enabled) continue;
      const scrobbler = enabledScrobblers.get(scrobblerName);
      const config = currentConfig();
      if (
        previous.scrobblers[scrobblerName as keyof typeof previous.scrobblers]
          .enabled !== scrobblerConfig.enabled &&
        scrobbler &&
        !scrobbler.isSessionCreated(config)
      ) {
        await scrobbler.createSession(config, setConfig);
      }
    }
  });
});
