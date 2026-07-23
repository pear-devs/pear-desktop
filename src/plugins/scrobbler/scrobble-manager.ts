import is from 'electron-is';

import {
  MediaType,
  SongInfoEvent,
  cleanupAlbum,
  cleanupArtist,
  cleanupTitle,
  type SongInfo,
} from '@/providers/song-info';

import type { ScrobblerPluginConfig } from './index';
import type { SetConfType } from './main';
import type { ScrobblerBase } from './services/base';

type ScrobblerName = keyof ScrobblerPluginConfig['scrobblers'];

// Dev-only debug logging.
export const scrobblerDebug = (...args: unknown[]): void => {
  if (is.dev()) console.log('[YTMusic] [Scrobbler]', ...args);
};

const secs = (ms: number): string => `${Math.round(ms / 1000)}s`;

interface ServiceTimer {
  scrobbled: boolean;
  remainingMs: number;
  timerStartedAt: number;
  timer?: NodeJS.Timeout;
}

// Per-service scrobble scheduler with independent timers and scrobbled flags.
export class ScrobbleManager {
  private readonly timers = new Map<ScrobblerName, ServiceTimer>();

  private currentKey?: string;
  private currentSongInfo?: SongInfo;
  private songStartedAtSeconds = 0;
  private songStarted = false;
  private isPlaying = false;
  private endedReached = false;

  constructor(
    private readonly scrobblers: Map<string, ScrobblerBase>,
    private config: ScrobblerPluginConfig,
    private readonly setConfig: SetConfType,
  ) {}

  updateConfig(config: ScrobblerPluginConfig): void {
    this.config = config;
  }

  onSongInfo(songInfo: SongInfo, event: SongInfoEvent): void {
    if (event === SongInfoEvent.VideoSrcChanged) {
      this.handleMetadata(songInfo);
    } else if (event === SongInfoEvent.PlayOrPaused) {
      this.handlePlayState(songInfo);
    }
  }

  onEnded(): void {
    if (this.songStarted) this.endedReached = true;
  }

  private timerFor(name: ScrobblerName): ServiceTimer {
    let state = this.timers.get(name);
    if (!state) {
      state = { scrobbled: false, remainingMs: 0, timerStartedAt: 0 };
      this.timers.set(name, state);
    }
    return state;
  }

  private eachService(
    fn: (name: ScrobblerName, scrobbler: ScrobblerBase) => void,
  ): void {
    for (const [name, scrobbler] of this.scrobblers) {
      fn(name as ScrobblerName, scrobbler);
    }
  }

  private handleMetadata(songInfo: SongInfo): void {
    const resolved = this.resolveSongInfo(songInfo);
    const key = resolved.videoId || `${resolved.artist}|${resolved.title}`;
    const skip = this.shouldSkipMedia(songInfo);
    this.isPlaying = !(songInfo.isPaused ?? true);

    if (key !== this.currentKey) {
      this.stopTimers();
      this.eachService((name) => {
        this.timerFor(name).scrobbled = false;
      });

      this.currentKey = key;
      this.songStarted = false;
      this.endedReached = false;

      // Clear current song for skipped media so later events don't act on it.
      this.currentSongInfo = skip ? undefined : resolved;

      if (skip) {
        scrobblerDebug(
          `skipped media (mediaType=${songInfo.mediaType}), not scrobbling`,
        );
        return;
      }

      scrobblerDebug(
        `new song: "${resolved.title}" - "${resolved.artist}" ` +
          `(duration=${resolved.songDuration}s, playing=${this.isPlaying})`,
      );
      if (this.isPlaying) this.onSongStart(songInfo.elapsedSeconds ?? 0);
      return;
    }

    if (skip || !this.currentSongInfo) return;

    // Same videoId re-firing after the track ended is a repeat-one loop.
    if (this.endedReached) {
      this.endedReached = false;
      scrobblerDebug(`replay detected (loop), re-arming "${resolved.title}"`);
      this.currentSongInfo = resolved;
      this.eachService((name) => {
        this.timerFor(name).scrobbled = false;
      });
      if (this.isPlaying) this.onSongStart(songInfo.elapsedSeconds ?? 0);
      else this.songStarted = false;
      return;
    }

    // Same song, metadata may have improved (e.g. duration was 0 initially).
    const improved = resolved.songDuration > this.currentSongInfo.songDuration;
    this.currentSongInfo = resolved;

    if (improved && this.songStarted && this.isPlaying) {
      scrobblerDebug(
        `metadata improved for "${resolved.title}": ` +
          `duration now ${resolved.songDuration}s, (re)starting timers`,
      );
      this.eachService((name, scrobbler) => {
        const state = this.timerFor(name);
        if (!state.scrobbled && !state.timer && state.timerStartedAt === 0) {
          this.startTimer(name);
        }
        if (this.config.scrobblers[name].nowPlaying) {
          scrobbler.setNowPlaying(resolved, this.config, this.setConfig);
        }
      });
    }
  }

  private shouldSkipMedia(songInfo: SongInfo): boolean {
    return (
      !this.config.scrobbleOtherMedia &&
      songInfo.mediaType !== MediaType.Audio &&
      songInfo.mediaType !== MediaType.OriginalMusicVideo
    );
  }

  private handlePlayState(songInfo: SongInfo): void {
    this.isPlaying = !(songInfo.isPaused ?? true);
    if (!this.currentSongInfo) return;

    const elapsed = songInfo.elapsedSeconds ?? 0;
    if (this.isPlaying) {
      if (!this.songStarted) this.onSongStart(elapsed);
      else this.onSongResume();
    } else {
      this.onSongPause();
    }
  }

  // Anchor start to actual playback moment (minus elapsed), not metadata load.
  private onSongStart(elapsedSeconds: number): void {
    this.songStarted = true;
    const nowSeconds = Date.now() / 1000;
    this.songStartedAtSeconds = nowSeconds - elapsedSeconds;
    scrobblerDebug(
      `song started (elapsed=${elapsedSeconds}s, ` +
        `startedAt=${Math.trunc(this.songStartedAtSeconds)})`,
    );
    this.eachService((name, scrobbler) => {
      this.startTimer(name);
      if (this.config.scrobblers[name].nowPlaying) {
        scrobblerDebug(`[${name}] sending now playing`);
        scrobbler.setNowPlaying(
          this.currentSongInfo!,
          this.config,
          this.setConfig,
        );
      }
    });
  }

  private onSongResume(): void {
    this.eachService((name) => {
      const state = this.timerFor(name);
      if (!state.scrobbled && state.remainingMs > 0) {
        this.cancelTimer(name);
        state.timerStartedAt = Date.now();
        scrobblerDebug(
          `[${name}] resumed, ${secs(state.remainingMs)} remaining`,
        );
        this.schedule(name, state.remainingMs);
      }
    });
  }

  private onSongPause(): void {
    if (!this.songStarted) return;
    scrobblerDebug('paused');
    this.pauseTimers();
  }

  private startTimer(name: ScrobblerName): void {
    this.cancelTimer(name);
    const state = this.timerFor(name);
    const cfg = this.config.scrobblers[name];
    const duration = this.currentSongInfo?.songDuration ?? 0;

    if (duration <= cfg.minSongDuration) {
      scrobblerDebug(
        `[${name}] duration ${duration}s <= min ${cfg.minSongDuration}s, ` +
          'skipping scrobble',
      );
      return;
    }

    const thresholdMs = Math.min(
      duration * 1000 * (cfg.delayPercent / 100),
      cfg.delaySeconds * 1000,
    );
    const startedAtMs = this.songStartedAtSeconds * 1000;
    const elapsedMs = Math.max(0, Date.now() - startedAtMs);
    state.remainingMs = thresholdMs - elapsedMs;

    if (state.remainingMs <= 0) {
      scrobblerDebug(`[${name}] threshold already passed, scrobbling now`);
      this.scrobble(name);
      return;
    }

    if (this.isPlaying) {
      state.timerStartedAt = Date.now();
      scrobblerDebug(
        `[${name}] scrobble in ${secs(state.remainingMs)} ` +
          `(threshold=${secs(thresholdMs)}, elapsed=${secs(elapsedMs)})`,
      );
      this.schedule(name, state.remainingMs);
    } else {
      state.timerStartedAt = 0;
    }
  }

  private pauseTimers(): void {
    this.eachService((name) => {
      const state = this.timerFor(name);
      if (state.scrobbled) return;
      this.cancelTimer(name);
      if (state.timerStartedAt !== 0) {
        state.remainingMs -= Date.now() - state.timerStartedAt;
        state.timerStartedAt = 0;
        if (state.remainingMs <= 0) {
          scrobblerDebug(
            `[${name}] threshold reached at pause, scrobbling now`,
          );
          this.scrobble(name);
        } else {
          scrobblerDebug(
            `[${name}] paused, ${secs(state.remainingMs)} remaining`,
          );
        }
      }
    });
  }

  private stopTimers(): void {
    this.eachService((name) => {
      const state = this.timerFor(name);
      this.cancelTimer(name);
      state.remainingMs = 0;
      state.timerStartedAt = 0;
    });
  }

  private schedule(name: ScrobblerName, delayMs: number): void {
    const state = this.timerFor(name);
    state.timer = setTimeout(() => {
      state.timer = undefined;
      this.scrobble(name);
    }, delayMs);
  }

  private cancelTimer(name: ScrobblerName): void {
    const state = this.timerFor(name);
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = undefined;
    }
  }

  private scrobble(name: ScrobblerName): void {
    const state = this.timerFor(name);
    if (state.scrobbled) {
      scrobblerDebug(`[${name}] already scrobbled, skipping duplicate`);
      return;
    }
    const scrobbler = this.scrobblers.get(name);
    if (!scrobbler || !this.currentSongInfo) return;
    scrobblerDebug(`[${name}] scrobbling "${this.currentSongInfo.title}"`);
    scrobbler.addScrobble(
      this.currentSongInfo,
      this.config,
      this.setConfig,
      this.songStartedAtSeconds,
    );
    // Done for this play: stop tracking so pause/resume no longer touch it.
    this.cancelTimer(name);
    state.scrobbled = true;
    state.remainingMs = 0;
    state.timerStartedAt = 0;
  }

  love(): void {
    if (!this.currentSongInfo) return;
    this.eachService((name, scrobbler) => {
      if (!this.config.scrobblers[name].loveOnLike) return;
      scrobblerDebug(`[${name}] love "${this.currentSongInfo!.title}"`);
      scrobbler.love(this.currentSongInfo!, this.config, this.setConfig);
    });
  }

  unlove(): void {
    if (!this.currentSongInfo) return;
    this.eachService((name, scrobbler) => {
      if (this.config.scrobblers[name].loveOnLike) {
        scrobblerDebug(`[${name}] unlove "${this.currentSongInfo!.title}"`);
        scrobbler.unlove(this.currentSongInfo!, this.config, this.setConfig);
      }
    });
  }

  get currentVideoId(): string | undefined {
    return this.currentSongInfo?.videoId;
  }

  private resolveSongInfo(songInfo: SongInfo): SongInfo {
    let title =
      this.config.alternativeTitles && songInfo.alternativeTitle !== undefined
        ? songInfo.alternativeTitle
        : songInfo.title;
    const firstTag = songInfo.tags?.at(0);
    let artist =
      this.config.alternativeArtist && firstTag !== undefined
        ? firstTag
        : songInfo.artist;
    let album = songInfo.album ?? undefined;

    if (this.config.parseTitle) {
      const idx = title.indexOf(' - ');
      if (idx > 0 && idx < title.length - 3) {
        const parsedArtist = title.slice(0, idx).trim();
        const parsedTrack = title.slice(idx + 3).trim();
        if (parsedArtist && parsedTrack) {
          artist = parsedArtist;
          title = parsedTrack;
        }
      }
    }

    if (this.config.metadataCleanup) {
      title = cleanupTitle(title);
      artist = cleanupArtist(artist);
      if (album) album = cleanupAlbum(album) || undefined;

      if (this.config.customRegex.trim()) {
        try {
          const re = new RegExp(this.config.customRegex, 'gi');
          title = title.replace(re, '').trim();
          artist = artist.replace(re, '').trim();
          if (album) album = album.replace(re, '').trim() || undefined;
        } catch {
          // Invalid user regex; leave metadata untouched.
        }
      }
    }

    return {
      ...songInfo,
      title,
      artist,
      album,
      alternativeTitle: undefined,
      tags: undefined,
    };
  }
}
