import {
  type BaseConnectionErrorType,
  type DataConnection,
  type DataConnectionErrorType,
  Peer,
  type PeerError,
  PeerErrorType,
} from 'peerjs';

import type {
  RemoveFailure,
  SessionCommand,
  SessionState,
} from './session-protocol';
import type { Profile } from './types';

export type ConnectionEventMap = {
  COMMAND: SessionCommand;
  QUEUE_ADD_RESULT: boolean;
  QUEUE_REMOVE_FAILED: RemoveFailure;
  REQUEST_STATE: null;
  PING: number;
  PONG: number;
  SESSION_STATE: SessionState;
  IDENTIFY: { profile: Profile };
  SYNC_PROFILE: { profiles: Record<string, Profile> };
};
export type ConnectionEventUnion = {
  [Event in keyof ConnectionEventMap]: {
    type: Event;
    payload: ConnectionEventMap[Event];
  };
}[keyof ConnectionEventMap];

type PromiseUtil<T> = {
  promise: Promise<T>;
  resolve: (id: T) => void;
  reject: (err: unknown) => void;
};

export type ConnectionListener = (
  event: ConnectionEventUnion,
  conn: DataConnection,
) => void;
export type ConnectionMode = 'host' | 'guest' | 'disconnected';

const RECOVERABLE_PEER_ERRORS = new Set([
  PeerErrorType.Network,
  PeerErrorType.ServerError,
  PeerErrorType.SocketError,
  PeerErrorType.SocketClosed,
]);

export class Connection {
  private peer: Peer;
  private _mode: ConnectionMode = 'disconnected';
  private connections: Record<string, DataConnection> = {};

  private isDestroyed = false;
  private isReconnecting = false;

  private waitOpen: PromiseUtil<string> = {} as PromiseUtil<string>;
  private listeners: ConnectionListener[] = [];
  private connectionListeners: ((connection?: DataConnection) => void)[] = [];

  constructor() {
    this.peer = new Peer({
      debug: 0,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          {
            urls: [
              'turn:eu-0.turn.peerjs.com:3478',
              'turn:us-0.turn.peerjs.com:3478',
            ],
            username: 'peerjs',
            credential: 'peerjsp',
          },
          {
            urls: 'stun:freestun.net:3478',
          },
          {
            urls: 'turn:freestun.net:3478',
            username: 'free',
            credential: 'free',
          },
        ],
        sdpSemantics: 'unified-plan',
      },
    });

    this.waitOpen.promise = new Promise<string>((resolve, reject) => {
      this.waitOpen.resolve = resolve;
      this.waitOpen.reject = reject;
    });

    this.peer.on('open', (id) => {
      if (this._mode === 'disconnected') this._mode = 'host';
      this.waitOpen.resolve(id);
    });

    this.peer.on('connection', async (conn) => {
      if (this._mode !== 'host') {
        conn.close();
        return;
      }
      try {
        await this.registerConnection(conn);
      } catch {
        // ignore
      }
    });

    this.peer.on('disconnected', async () => {
      if (this.isDestroyed) return;
      console.warn('Music Together: lost server connection, reconnecting...');
      await this.reconnectLoop();
    });

    this.peer.on('close', () => this.cleanup());

    this.peer.on('error', async (err) => {
      if (!this.isDestroyed && RECOVERABLE_PEER_ERRORS.has(err.type)) {
        console.warn('Music Together: recoverable peer error', err.type);
        await this.reconnectLoop();
        return;
      }
      if (err.type === 'peer-unavailable') return;
      if (err.type === 'unavailable-id') {
        console.warn(
          'Music Together: id no longer available, staying on existing connections.',
        );
        this.isReconnecting = false;
        return;
      }

      console.error('Music Together: fatal peer error', err);
      this.waitOpen.reject(err);
      this.disconnect();
    });
  }

  /* public */
  async waitForReady() {
    return this.withTimeout(this.waitOpen.promise);
  }

  async connect(id: string) {
    this._mode = 'guest';
    const conn = this.peer.connect(id, {
      reliable: true,
    });
    if (!conn) throw new Error('Music Together: peer server disconnected');

    let onError!: (err: PeerError<`${PeerErrorType}`>) => void;
    const unavailable = new Promise<never>((_, reject) => {
      onError = (err) => {
        if (err.type === 'peer-unavailable') reject(err);
      };
    });
    this.peer.on('error', onError);
    try {
      return await this.withTimeout(
        Promise.race([this.registerConnection(conn), unavailable]),
      );
    } catch (error) {
      conn.close();
      throw error;
    } finally {
      this.peer.off('error', onError);
    }
  }

  disconnect() {
    if (this.isDestroyed) return;

    this.isDestroyed = true;
    this.isReconnecting = false;
    this._mode = 'disconnected';

    this.getConnections().forEach((conn) =>
      conn.close({
        flush: true,
      }),
    );

    if (!this.peer.destroyed) this.peer.destroy();
    else this.cleanup();
  }

  /* utils */
  public get id() {
    return this.peer.id;
  }

  public get mode() {
    return this._mode;
  }

  public getConnections() {
    return Object.values(this.connections);
  }

  public async send<Event extends keyof ConnectionEventMap>(
    conn: DataConnection,
    type: Event,
    payload: ConnectionEventMap[Event],
  ) {
    if (!conn.open) return;
    try {
      await conn.send({ type, payload });
    } catch (error) {
      console.warn('Music Together: Could not send message', error);
    }
  }

  public async broadcast<Event extends keyof ConnectionEventMap>(
    type: Event,
    payload: ConnectionEventMap[Event],
  ) {
    await Promise.all(
      this.getConnections().map((conn) => this.send(conn, type, payload)),
    );
  }

  public on(listener: ConnectionListener) {
    if (!this.listeners.includes(listener)) {
      this.listeners.push(listener);
    }
  }

  public onConnections(listener: (connections?: DataConnection) => void) {
    this.connectionListeners.push(listener);
  }

  /* privates */
  private async withTimeout<T>(operation: Promise<T>) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const promise = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('Music Together: connection timed out')),
        15_000,
      );
    });
    try {
      return await Promise.race([operation, promise]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async reconnectLoop() {
    if (this.isDestroyed || this.isReconnecting || this.peer.destroyed) return;
    this.isReconnecting = true;

    let attempt = 0;
    while (
      !this.isDestroyed &&
      this.peer.disconnected &&
      !this.peer.destroyed
    ) {
      attempt += 1;
      const factor = 2 ** (attempt - 1);
      const backoff = Math.min(30_000, 1_000 * factor);
      console.warn(`Music Together: reconnect attempt ${attempt}...`);
      try {
        this.peer.reconnect();
      } catch (err) {
        console.error('Music Together: reconnect() threw', err);
      }
      await new Promise<void>((resolve) => setTimeout(resolve, backoff));
    }

    this.isReconnecting = false;
  }

  private cleanup() {
    this.waitOpen.reject(new Error('Music Together: connection closed'));
    this._mode = 'disconnected';
    this.connections = {};

    this.listeners = [];

    this.connectionListeners.forEach((listener) => listener());
    this.connectionListeners = [];
  }

  private async registerConnection(conn: DataConnection) {
    return new Promise<DataConnection>((resolve, reject) => {
      conn.on('open', () => {
        this.connections[conn.connectionId] = conn;
        resolve(conn);
        this.connectionListeners.forEach((listener) => listener(conn));

        conn.on('data', (data) => {
          if (
            !data ||
            typeof data !== 'object' ||
            !('type' in data) ||
            !('payload' in data) ||
            !data.type
          ) {
            console.warn('Music Together: Invalid data', data);
            return;
          }

          for (const listener of this.listeners) {
            listener(data as ConnectionEventUnion, conn);
          }
        });
      });

      let closed = false;
      const onClose = (
        err?: PeerError<`${DataConnectionErrorType | BaseConnectionErrorType}`>,
      ) => {
        if (closed) return;
        closed = true;
        if (conn.open) conn.close();
        delete this.connections[conn.connectionId];
        reject(err ?? new Error('Music Together: data channel closed'));
        this.connectionListeners.forEach((listener) => listener(conn));
      };
      conn.on('error', onClose);
      conn.on('close', onClose);
    });
  }
}
