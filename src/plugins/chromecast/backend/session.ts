import { LoggerPrefix } from '@/utils';

import type {
  Client as CastClient,
  DefaultMediaReceiver as CastReceiver,
  MediaInformation,
  MediaStatus,
} from 'castv2-client';
import type { CastDevice } from '../types';

export interface CastSessionEvents {
  /** Fired when the receiver finishes a track on its own. */
  onFinished?: () => void;
  /** Fired on a fatal connection error (device unreachable, closed, etc.). */
  onClosed?: (err?: Error) => void;
  /** Raw media status updates from the receiver. */
  onStatus?: (status: MediaStatus) => void;
}

/**
 * Thin promise wrapper around a single `castv2-client` session against one
 * device: connect -> launch Default Media Receiver -> load/control media.
 *
 * `castv2-client` is loaded lazily (dynamic import) so this CommonJS dependency
 * never lands in the renderer bundle when the plugin loader strips the backend.
 */
export class CastSession {
  private client: CastClient | null = null;
  private player: CastReceiver | null = null;
  private closed = false;

  constructor(
    readonly device: CastDevice,
    private readonly events: CastSessionEvents = {},
  ) {}

  async connect(): Promise<void> {
    const { Client, DefaultMediaReceiver } = await import('castv2-client');
    return new Promise((resolve, reject) => {
      const client = new Client();
      this.client = client;

      client.on('error', (err) => {
        console.error(LoggerPrefix, '[chromecast] client error', err);
        this.teardown(err);
        reject(err);
      });

      client.connect({ host: this.device.host, port: this.device.port }, () => {
        client.launch<CastReceiver>(DefaultMediaReceiver, (err, player) => {
          if (err || !player) {
            this.teardown(err ?? undefined);
            reject(err ?? new Error('Failed to launch receiver'));
            return;
          }
          this.player = player;
          // castv2 throws on the player/connection emitters too; an unhandled
          // 'error' here would crash the whole app.
          player.on('error', (e: Error) => {
            console.error(LoggerPrefix, '[chromecast] player error', e);
            this.teardown(e);
          });
          player.on('status', (status) => {
            this.events.onStatus?.(status);
            if (
              status?.playerState === 'IDLE' &&
              status?.idleReason === 'FINISHED'
            ) {
              this.events.onFinished?.();
            }
          });
          resolve();
        });
      });
    });
  }

  load(
    media: MediaInformation,
    currentTime = 0,
    autoplay = true,
  ): Promise<MediaStatus> {
    return new Promise((resolve, reject) => {
      if (!this.player) return reject(new Error('Not connected'));
      this.player.load(
        media,
        { autoplay, currentTime: Math.max(0, Math.floor(currentTime)) },
        (err, status) => (err ? reject(err) : resolve(status)),
      );
    });
  }

  play() {
    this.player?.play(() => {});
  }

  pause() {
    this.player?.pause(() => {});
  }

  seek(seconds: number) {
    this.player?.seek(Math.max(0, seconds), () => {});
  }

  setVolume(level: number) {
    this.client?.setVolume(
      { level: Math.min(1, Math.max(0, level)) },
      () => {},
    );
  }

  disconnect() {
    // Send STOP and give it time to reach the device before closing the
    // socket, otherwise the speaker keeps playing the buffered audio.
    if (this.player && !this.closed) {
      this.player.stop(() => this.teardown());
      setTimeout(() => this.teardown(), 1500);
    } else {
      this.teardown();
    }
  }

  get isConnected() {
    return !this.closed && !!this.player;
  }

  private teardown(err?: Error) {
    if (this.closed) return;
    this.closed = true;
    this.player = null;
    try {
      this.client?.close();
    } catch {
      /* ignore */
    }
    this.client = null;
    this.events.onClosed?.(err);
  }
}
