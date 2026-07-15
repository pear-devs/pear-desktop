import { type BrowserWindow } from 'electron';

import { registerCallback, type SongInfo } from '@/providers/song-info';
import { LikeType } from '@/types/datahost-get-state';
import { createBackend } from '@/utils';

import { ScrobbleManager } from './scrobble-manager';
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
    manager?: ScrobbleManager;
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

  async start({ getConfig, setConfig, window, ipc }) {
    const config = (this.config = await getConfig());

    this.window = window;
    this.toggleScrobblers(config, window);
    await this.createSessions(config, setConfig);
    this.setConfig = setConfig;

    const manager = (this.manager = new ScrobbleManager(
      this.enabledScrobblers,
      config,
      setConfig,
    ));

    registerCallback((songInfo: SongInfo, event) => {
      manager.onSongInfo(songInfo, event);
    });

    ipc.on('peard:video-ended', () => manager.onEnded());

    // The renderer emits an initial like-status per song plus one on every
    // toggle. Dedupe by video + status and skip the spurious unlove on first
    // load, so only genuine like/unlike actions reach the scrobblers.
    let lastLikeVideoId: string | undefined;
    let lastLikeStatus: LikeType | undefined;
    ipc.on('peard:like-changed', (status: LikeType) => {
      const videoId = manager.currentVideoId;
      if (videoId === lastLikeVideoId && status === lastLikeStatus) return;
      const firstForSong = videoId !== lastLikeVideoId;
      lastLikeVideoId = videoId;
      lastLikeStatus = status;

      if (status === LikeType.Like) manager.love();
      else if (!firstForSong) manager.unlove();
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
    this.manager?.updateConfig(newConfig);
  },
});
