import { LoggerPrefix } from '@/utils';

import { AudioProxy } from './proxy';
import { CastDiscovery } from './discovery';
import { CastSession } from './session';
import { expectedElapsed, isSeek } from './util';

import type { SongInfo } from '@/providers/song-info';
import type { CastDevice, ChromecastPluginConfig } from '../types';

type SongChange = 'src' | 'play-or-paused' | 'time';

/**
 * Singleton orchestrator. Owns discovery, the active cast session, and the
 * audio proxy, and mirrors the local YouTube Music player state to the
 * connected speaker. Local audio muting is handled in the renderer (via the
 * <video> element) so it never persists to YTM's stored volume.
 */
class CastController {
  private readonly discovery = new CastDiscovery();
  private readonly proxy = new AudioProxy();
  private session: CastSession | null = null;

  private config: ChromecastPluginConfig | null = null;
  private setConfig: ((c: Partial<ChromecastPluginConfig>) => void) | null =
    null;

  private currentSong: SongInfo | null = null;
  private lastCastVideoId: string | null = null;

  // Seek detection: track the last observed elapsed time and the wall-clock
  // moment we saw it. A jump away from the expected (~real-time) progression
  // means the user scrubbed locally, which we mirror to the speaker.
  private lastElapsed = 0;
  private lastTimeAt = 0;

  // While YouTube Music shows an ad on the LOCAL player we must not mirror it
  // to the speaker (we never want ads on the Home, and the speaker should keep
  // playing the real song). The renderer detects ads, fast-skips them, and
  // pushes the state here.
  private adShowing = false;

  // After a LOAD we resync once: the speaker starts a beat later than the local
  // (muted) player due to download/remux/buffer latency, so the local conductor
  // would otherwise run ahead and clip the speaker at the track boundary.
  private awaitingSync = false;

  // Last play/pause state reported by the speaker, so we can reflect *external*
  // control (e.g. pausing from the Google Home app on a phone) back onto the
  // local conductor — the reverse of our normal local -> speaker mirroring.
  private lastRemotePlayerState: string | null = null;

  private onDevicesChanged?: (devices: CastDevice[]) => void;
  private onStateChanged?: (activeId: string | null) => void;
  private onSyncLocal?: (seconds: number) => void;
  private onRemotePlayback?: (action: 'play' | 'pause') => void;
  // `@/providers/song-info` callbacks are additive with no unregister API, and
  // this controller is a long-lived singleton, so we register exactly once even
  // if the plugin is stopped and restarted within the same session.
  private callbackRegistered = false;

  async start(
    config: ChromecastPluginConfig,
    setConfig: (c: Partial<ChromecastPluginConfig>) => void,
  ) {
    this.config = config;
    this.setConfig = setConfig;

    // Imported lazily so the module stays side-effect-free at import time.
    // (`@/providers/song-info` transitively pulls `@/config`/electron-store,
    // which must never reach the renderer bundle via the shared index.ts.)
    const { registerCallback, SongInfoEvent } = await import(
      '@/providers/song-info'
    );

    await this.proxy.start(config.serverPort);
    this.discovery.start((devices) => this.onDevicesChanged?.(devices));

    if (!this.callbackRegistered) {
      this.callbackRegistered = true;
      registerCallback((info, event) => {
        const change: SongChange =
          event === SongInfoEvent.VideoSrcChanged
            ? 'src'
            : event === SongInfoEvent.PlayOrPaused
              ? 'play-or-paused'
              : 'time';
        this.onSongEvent(info, change).catch(console.error);
      });
    }

    if (config.autoConnect && config.lastDeviceId) {
      // Give discovery a moment to populate before reconnecting.
      setTimeout(() => {
        const device = this.discovery.get(config.lastDeviceId!);
        if (device) this.connectTo(device.id).catch(console.error);
      }, 3000);
    }
  }

  stop() {
    this.disconnect();
    this.discovery.stop();
    this.proxy.stop();
  }

  // --- device registry -----------------------------------------------------

  listDevices(): CastDevice[] {
    return this.discovery.list();
  }

  refreshDevices() {
    this.discovery.refresh();
  }

  onDevices(cb: (devices: CastDevice[]) => void) {
    this.onDevicesChanged = cb;
  }

  /** Subscribe to connect/disconnect transitions (passes the active id or null). */
  onState(cb: (activeId: string | null) => void) {
    this.onStateChanged = cb;
  }

  /** Subscribe to one-shot "seek the local player to N seconds" sync requests. */
  onSyncLocalTime(cb: (seconds: number) => void) {
    this.onSyncLocal = cb;
  }

  /** Subscribe to external play/pause changes made on the speaker itself. */
  onRemotePlaybackChange(cb: (action: 'play' | 'pause') => void) {
    this.onRemotePlayback = cb;
  }

  private emitState() {
    this.onStateChanged?.(this.activeDeviceId);
  }

  get activeDeviceId(): string | null {
    return this.session?.device.id ?? null;
  }

  // --- session lifecycle ---------------------------------------------------

  async connectTo(deviceId: string) {
    const device = this.discovery.get(deviceId);
    if (!device) {
      console.warn(LoggerPrefix, `[chromecast] unknown device ${deviceId}`);
      return;
    }
    this.disconnect();

    const session = new CastSession(device, {
      onClosed: (err) => {
        if (err)
          console.error(LoggerPrefix, '[chromecast] session closed', err);
        if (this.session === session) this.handleDisconnected();
      },
      onStatus: (status) => this.handleStatus(status),
    });
    this.session = session;

    try {
      await session.connect();
      session.setVolume(this.config?.castVolume ?? 0.4);
      this.setConfig?.({ lastDeviceId: device.id });
      console.log(LoggerPrefix, `[chromecast] connected to ${device.name}`);
      this.emitState();
      // Reset so the same track re-casts even if it was cast in a prior session.
      this.lastCastVideoId = null;
      this.lastRemotePlayerState = null;
      await this.castCurrentSong();
    } catch (err) {
      console.error(LoggerPrefix, '[chromecast] connect failed', err);
      this.handleDisconnected();
    }
  }

  disconnect() {
    if (!this.session) return;
    this.session.disconnect();
    this.session = null;
    this.handleDisconnected();
  }

  private handleDisconnected() {
    this.session = null;
    this.lastCastVideoId = null;
    this.lastRemotePlayerState = null;
    this.emitState();
  }

  // --- playback mirroring --------------------------------------------------

  private async onSongEvent(info: SongInfo, event: SongChange) {
    this.currentSong = info;
    if (!this.session?.isConnected) return;
    // While an ad is on the LOCAL player, don't mirror anything to the speaker:
    // the Home should keep playing the real song, and we never cast ads.
    if (this.adShowing) return;

    switch (event) {
      case 'src':
        this.resetSeekBaseline(info);
        await this.castCurrentSong();
        break;
      case 'play-or-paused':
        this.resetSeekBaseline(info);
        if (info.isPaused) this.session.pause();
        else this.session.play();
        break;
      case 'time':
        this.maybeMirrorSeek(info);
        break;
      default:
        break;
    }
  }

  /**
   * One-shot resync: when the speaker first reports PLAYING after a load, if the
   * local (muted) player has run ahead of it, pull the local clock back to the
   * speaker's position. Because the local player is silent while casting, this
   * seek is inaudible — it just keeps the conductor from clipping the speaker at
   * the next track boundary. Only runs when local muting is on.
   */
  private handleStatus(status: { playerState?: string; currentTime?: number }) {
    this.reconcileRemotePlayback(status);

    if (!this.awaitingSync) return;
    if (status?.playerState !== 'PLAYING') return;
    this.awaitingSync = false;

    const remote = status.currentTime;
    if (typeof remote !== 'number' || !Number.isFinite(remote)) return;
    if (!(this.config?.muteLocalWhenCasting ?? true)) return;

    const localNow = this.estimateLocalElapsed();
    if (localNow - remote > 1) {
      // Pre-set the seek baseline so the resulting local TimeChanged isn't
      // misread as a user scrub (which would bounce a seek back to the speaker).
      this.lastElapsed = remote;
      this.lastTimeAt = Date.now();
      this.onSyncLocal?.(remote);
    }
  }

  /**
   * Reflect *external* play/pause control (e.g. from the Google Home app on a
   * phone) back onto the local conductor. Edge-triggered on the speaker's
   * playerState and only acts when it disagrees with the local state, so our
   * own local -> speaker mirroring can't create a feedback loop (the local op
   * leaves both sides in agreement, so the resulting status is a no-op).
   */
  private reconcileRemotePlayback(status: { playerState?: string }) {
    const ps = status?.playerState;
    if (ps !== 'PLAYING' && ps !== 'PAUSED') return;
    if (ps === this.lastRemotePlayerState) return;
    this.lastRemotePlayerState = ps;

    const remotePaused = ps === 'PAUSED';
    const localPaused = this.currentSong?.isPaused ?? false;
    if (remotePaused !== localPaused) {
      this.onRemotePlayback?.(remotePaused ? 'pause' : 'play');
    }
  }

  private resetSeekBaseline(info: SongInfo) {
    this.lastElapsed = info.elapsedSeconds ?? 0;
    this.lastTimeAt = Date.now();
  }

  /**
   * Detect a local scrub by comparing the reported elapsed time against the
   * value we'd expect from real-time progression. A large discontinuity means
   * the user dragged the progress bar — mirror it to the speaker.
   */
  private maybeMirrorSeek(info: SongInfo) {
    const elapsed = info.elapsedSeconds ?? 0;

    if (this.lastTimeAt !== 0 && !info.isPaused) {
      // TimeChanged fires on whole-second boundaries, so the default 3s slack
      // avoids false positives; only real scrubs jump further.
      if (isSeek(this.lastElapsed, this.lastTimeAt, elapsed, Date.now())) {
        this.session?.seek(elapsed);
      }
    }

    this.lastElapsed = elapsed;
    this.lastTimeAt = Date.now();
  }

  /** Estimate where the local player is now from the last time-change baseline. */
  private estimateLocalElapsed(): number {
    return expectedElapsed(this.lastElapsed, this.lastTimeAt, Date.now());
  }

  /**
   * Called from the renderer when YouTube Music shows/hides an ad on the local
   * player. While an ad shows we suppress mirroring; when it clears we refresh
   * the baseline so the next time tick isn't mistaken for a seek.
   */
  setAdShowing(showing: boolean) {
    if (this.adShowing === showing) return;
    this.adShowing = showing;
    if (!showing && this.currentSong) this.resetSeekBaseline(this.currentSong);
  }

  private async castCurrentSong() {
    const info = this.currentSong;
    const session = this.session;
    if (!info?.videoId || !session?.isConnected) return;
    if (info.videoId === this.lastCastVideoId) return;
    this.lastCastVideoId = info.videoId;

    try {
      const contentType = await this.proxy.contentType(info.videoId);
      // The user may have disconnected (or the session errored/changed) while
      // we awaited the proxy; bail cleanly instead of dereferencing a stale one.
      if (this.session !== session || !session.isConnected) {
        this.lastCastVideoId = null;
        return;
      }
      await session.load(
        {
          contentId: this.proxy.mediaUrl(info.videoId),
          contentType,
          streamType: 'BUFFERED',
          duration: info.songDuration || undefined,
          metadata: {
            type: 0,
            metadataType: 3, // MusicTrackMediaMetadata
            title: info.title,
            artist: info.artist,
            albumName: info.album ?? undefined,
            images: info.imageSrc ? [{ url: info.imageSrc }] : undefined,
          },
        },
        info.elapsedSeconds ?? 0,
        !info.isPaused,
      );
      // Resync the local conductor to the speaker once it actually starts.
      this.awaitingSync = true;
    } catch (err) {
      console.error(LoggerPrefix, '[chromecast] cast load failed', err);
      this.lastCastVideoId = null;
    }
  }

  updateConfig(config: ChromecastPluginConfig) {
    this.config = config;
  }

  /** Set the connected speaker's volume (0..1) — driven by the YTM slider. */
  setDeviceVolume(level: number) {
    this.session?.setVolume(level);
  }
}

// Lazily instantiated so this module stays side-effect-free at import time.
// That lets the renderer build tree-shake the entire backend chain (which
// imports `electron`) once the plugin loader strips the `backend`/`menu`
// properties from index.ts.
let controllerInstance: CastController | null = null;
export const getCastController = (): CastController =>
  (controllerInstance ??= new CastController());
