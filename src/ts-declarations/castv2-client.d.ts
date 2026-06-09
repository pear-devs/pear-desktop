// Minimal ambient declarations for the parts of `castv2-client` this app uses.
// `castv2-client` is pure-JS (no bundled types). Upstream:
// https://github.com/thibauts/node-castv2-client
declare module 'castv2-client' {
  import type { EventEmitter } from 'node:events';

  export interface MediaMetadata {
    type?: number;
    metadataType?: number;
    title?: string;
    artist?: string;
    albumName?: string;
    images?: { url: string }[];
  }

  export interface MediaInformation {
    contentId: string;
    contentType: string;
    streamType?: 'BUFFERED' | 'LIVE';
    metadata?: MediaMetadata;
    duration?: number;
  }

  export interface MediaStatus {
    mediaSessionId?: number;
    playerState?: 'IDLE' | 'PLAYING' | 'BUFFERING' | 'PAUSED';
    currentTime?: number;
    idleReason?: 'CANCELLED' | 'INTERRUPTED' | 'FINISHED' | 'ERROR';
    volume?: { level?: number; muted?: boolean };
  }

  type Callback<T> = (err: Error | null, result: T) => void;

  export class DefaultMediaReceiver extends EventEmitter {
    load(
      media: MediaInformation,
      options: { autoplay?: boolean; currentTime?: number },
      callback: Callback<MediaStatus>,
    ): void;
    play(callback?: Callback<MediaStatus>): void;
    pause(callback?: Callback<MediaStatus>): void;
    stop(callback?: Callback<MediaStatus>): void;
    seek(currentTime: number, callback?: Callback<MediaStatus>): void;
    getStatus(callback: Callback<MediaStatus>): void;
    on(event: 'status', listener: (status: MediaStatus) => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
  }

  export class Client extends EventEmitter {
    connect(
      host: string | { host: string; port?: number },
      callback: () => void,
    ): void;
    close(): void;
    launch<T>(
      receiver: { APP_ID?: string } | typeof DefaultMediaReceiver,
      callback: Callback<T>,
    ): void;
    getVolume(callback: Callback<{ level: number; muted: boolean }>): void;
    setVolume(
      options: { level?: number; muted?: boolean },
      callback?: Callback<{ level: number; muted: boolean }>,
    ): void;
    getStatus(callback: Callback<unknown>): void;
    on(event: 'error', listener: (err: Error) => void): this;
    on(event: 'status', listener: (status: unknown) => void): this;
  }
}
