import { MediaType, SongInfoEvent, type SongInfo } from '@/providers/song-info';

import type { ScrobblerPluginConfig } from './index';
import type { SetConfType } from './main';
import type { ScrobblerBase } from './services/base';

type ScrobblerName = keyof ScrobblerPluginConfig['scrobblers'];

interface ServiceTimer {
  scrobbled: boolean;
  remainingMs: number;
  timerStartedAt: number;
  timer?: NodeJS.Timeout;
}

/**
 * Stateful, per-service scrobble scheduler. Tracks separate timers and
 * "already scrobbled" flags for each service so seeking, looping and
 * pause/resume never cause duplicate or lost scrobbles.
 */
export class ScrobbleManager {
  private readonly timers = new Map<ScrobblerName, ServiceTimer>();

  private currentKey?: string;
  private currentSongInfo?: SongInfo;
  private songStartedAtSeconds = 0;
  private songStarted = false;
  private isPlaying = false;

  constructor(
    private readonly scrobblers: Map<string, ScrobblerBase>,
    private config: ScrobblerPluginConfig,
    private readonly setConfig: SetConfType,
  ) {}

  updateConfig(config: ScrobblerPluginConfig): void {
    this.config = config;
  }

  onSongInfo(songInfo: SongInfo, event: SongInfoEvent): void {
    if (event === SongInfoEvent.TimeChanged) return;

    if (event === SongInfoEvent.VideoSrcChanged) {
      this.handleMetadata(songInfo);
    } else if (event === SongInfoEvent.PlayOrPaused) {
      this.handlePlayState(songInfo);
    }
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
    this.isPlaying = !songInfo.isPaused;

    if (key !== this.currentKey) {
      this.stopTimers();
      this.eachService((name) => {
        this.timerFor(name).scrobbled = false;
      });

      this.currentKey = key;
      this.songStarted = false;

      // Skipped media clears the current song so later play/pause events
      // never act on the previously playing track.
      this.currentSongInfo = skip ? undefined : resolved;
      if (!skip && this.isPlaying) {
        this.onSongStart(songInfo.elapsedSeconds ?? 0);
      }
      return;
    }

    if (skip || !this.currentSongInfo) return;

    // Same song, metadata may have improved (e.g. duration was 0 initially).
    const improved = resolved.songDuration > this.currentSongInfo.songDuration;
    this.currentSongInfo = resolved;

    if (improved && this.songStarted && this.isPlaying) {
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
    this.isPlaying = !songInfo.isPaused;
    if (!this.currentSongInfo) return;

    if (this.isPlaying) {
      if (!this.songStarted) this.onSongStart(songInfo.elapsedSeconds ?? 0);
      else this.onSongResume();
    } else {
      this.onSongPause();
    }
  }

  // Anchor the play start to when playback actually begins (minus any elapsed
  // time already played), so the scrobble threshold is measured correctly even
  // if the song was loaded paused or play was delayed.
  private onSongStart(elapsedSeconds: number): void {
    this.songStarted = true;
    const nowSeconds = Date.now() / 1000;
    this.songStartedAtSeconds = nowSeconds - elapsedSeconds;
    this.eachService((name, scrobbler) => {
      this.startTimer(name);
      if (this.config.scrobblers[name].nowPlaying) {
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
        this.schedule(name, state.remainingMs);
      }
    });
  }

  private onSongPause(): void {
    if (!this.songStarted) return;
    this.pauseTimers();
  }

  private startTimer(name: ScrobblerName): void {
    this.cancelTimer(name);
    const state = this.timerFor(name);
    const cfg = this.config.scrobblers[name];
    const duration = this.currentSongInfo?.songDuration ?? 0;

    if (duration <= cfg.minSongDuration) return;

    const thresholdMs = Math.min(
      duration * 1000 * (cfg.delayPercent / 100),
      cfg.delaySeconds * 1000,
    );
    const startedAtMs = this.songStartedAtSeconds * 1000;
    const elapsedMs = Math.max(0, Date.now() - startedAtMs);
    state.remainingMs = thresholdMs - elapsedMs;

    if (state.remainingMs <= 0) {
      this.scrobble(name);
      return;
    }

    if (this.isPlaying) {
      state.timerStartedAt = Date.now();
      this.schedule(name, state.remainingMs);
    } else {
      state.timerStartedAt = 0;
    }
  }

  private pauseTimers(): void {
    this.eachService((name) => {
      const state = this.timerFor(name);
      this.cancelTimer(name);
      if (state.timerStartedAt !== 0) {
        state.remainingMs -= Date.now() - state.timerStartedAt;
        if (state.remainingMs < 0) state.remainingMs = 0;
        state.timerStartedAt = 0;
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
    if (state.scrobbled) return;
    const scrobbler = this.scrobblers.get(name);
    if (!scrobbler || !this.currentSongInfo) return;
    scrobbler.addScrobble(
      this.currentSongInfo,
      this.config,
      this.setConfig,
      this.songStartedAtSeconds,
    );
    state.scrobbled = true;
  }

  love(): void {
    if (!this.currentSongInfo) return;
    this.eachService((name, scrobbler) => {
      if (this.config.scrobblers[name].loveOnLike) {
        scrobbler.love(this.currentSongInfo!, this.config, this.setConfig);
      }
    });
  }

  unlove(): void {
    if (!this.currentSongInfo) return;
    this.eachService((name, scrobbler) => {
      if (this.config.scrobblers[name].loveOnLike) {
        scrobbler.unlove(this.currentSongInfo!, this.config, this.setConfig);
      }
    });
  }

  get currentVideoId(): string | undefined {
    return this.currentSongInfo?.videoId;
  }

  private resolveSongInfo(songInfo: SongInfo): SongInfo {
    let title = songInfo.title;
    let artist = songInfo.artist;
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

    if (this.config.metadataCleanup && this.config.customRegex.trim()) {
      try {
        const re = new RegExp(this.config.customRegex, 'gi');
        title = title.replace(re, '').trim();
        artist = artist.replace(re, '').trim();
        if (album) album = album.replace(re, '').trim() || undefined;
      } catch {
        // Invalid user regex; leave metadata untouched.
      }
    }

    return { ...songInfo, title, artist, album };
  }
}
