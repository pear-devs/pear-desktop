import type { MusicPlayer } from '@/types/music-player';

const POLL_INTERVAL = 100;
// Ignore readiness right after a song is requested, so a song that was already
// loaded is not reported before the requested reload happens.
const SETTLE_TIME = 300;

const PLAYING = 1;
const PAUSED = 2;
const CUED = 5;

/**
 * Keeps playback paused while a song change spreads to everyone in the
 * session, and reports once the expected song has loaded.
 */
export class PlaybackHold {
  private player?: MusicPlayer;
  private poll?: number;
  private expireTimer?: number;

  private target?: string;
  private targetSetAt = 0;
  private onReady?: () => void;

  setPlayer(player: MusicPlayer) {
    this.player = player;
  }

  get active() {
    return this.poll !== undefined;
  }

  /**
   * Starts (or extends) the hold. `onExpire` runs if nothing releases the hold
   * within `maxDuration` ms, so playback can never stay stuck.
   */
  start(maxDuration: number, onExpire: () => void) {
    if (this.expireTimer !== undefined) clearTimeout(this.expireTimer);
    this.expireTimer = window.setTimeout(() => {
      this.expireTimer = undefined;
      onExpire();
    }, maxDuration);

    if (this.active) return;
    this.poll = window.setInterval(() => this.tick(), POLL_INTERVAL);
    this.tick();
  }

  /** Calls `onReady` once, after `videoId` has loaded. */
  expect(videoId: string, onReady: () => void) {
    this.target = videoId;
    this.targetSetAt = performance.now();
    this.onReady = onReady;
    this.tick();
  }

  release(resume: boolean) {
    if (this.expireTimer !== undefined) clearTimeout(this.expireTimer);
    this.expireTimer = undefined;
    this.target = undefined;
    this.onReady = undefined;

    if (!this.active) return;
    clearInterval(this.poll);
    this.poll = undefined;

    if (resume) this.player?.playVideo();
  }

  /** Also called on every player state change, to pause as soon as possible. */
  tick() {
    if (!this.active || !this.player) return;

    const state = this.player.getPlayerState();
    if (state === PLAYING) this.player.pauseVideo();

    if (
      this.onReady &&
      this.target &&
      performance.now() - this.targetSetAt >= SETTLE_TIME &&
      this.player.getVideoData()?.video_id === this.target &&
      (state === PLAYING || state === PAUSED || state === CUED)
    ) {
      const onReady = this.onReady;
      this.onReady = undefined;
      onReady();
    }
  }
}
