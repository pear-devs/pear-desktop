import { EventEmitter } from 'node:events';

import { Client } from 'castv2';

// Adapted from Venipa/ytmdesktop2; see THIRD_PARTY_CAST.md.
import type { CastSessionSnapshot } from './session-types';

const log = console;
const HEARTBEAT_MS = 5000;
const LAUNCH_TIMEOUT_MS = 12000;
const CONNECTION_NS = 'urn:x-cast:com.google.cast.tp.connection';
const HEARTBEAT_NS = 'urn:x-cast:com.google.cast.tp.heartbeat';
const RECEIVER_NS = 'urn:x-cast:com.google.cast.receiver';
const MEDIA_NS = 'urn:x-cast:com.google.cast.media';

type Channel = {
  send: (data: unknown) => void;
  on: (event: 'message', listener: (data: unknown) => void) => void;
};

type ReceiverEndpoint = {
  host: string;
  port: number;
  name: string;
};

let handleSeq = 0;

export class CastDeviceSession extends EventEmitter {
  readonly handle: string;
  private client: Client;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private appId: string;
  private displayName: string;
  private receiverName: string;
  private sessionId = '';
  private statusText: string | null = null;
  private transportId: string | null = null;
  private senderId: string;
  private status: CastSessionSnapshot['status'] = 'disconnected';
  private namespaces: Array<{ name: string }> = [];
  private volume = { level: 1, muted: false };
  private channels = new Map<string, Channel>();
  private receiverChannel: Channel | null = null;
  private requestId = 1;
  private lastUpdateKey = '';

  constructor(receiverName: string, appId: string) {
    super();
    this.handle = `cast-${Date.now()}-${++handleSeq}`;
    this.appId = appId;
    this.displayName = receiverName;
    this.receiverName = receiverName;
    this.senderId = `client-${Math.floor(Math.random() * 1e6)}`;
    this.client = new Client();
    this.client.on('error', (err: unknown) => {
      log.warn('client error', err);
      this.teardown('disconnected');
    });
  }

  snapshot(): CastSessionSnapshot {
    return {
      handle: this.handle,
      sessionId: this.sessionId,
      appId: this.appId,
      displayName: this.displayName,
      status: this.status,
      statusText: this.statusText,
      namespaces: this.namespaces,
      receiver: { name: this.receiverName, volume: { ...this.volume } },
    };
  }

  connect(receiver: ReceiverEndpoint, launch = true): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('launch timeout'));
        this.teardown('disconnected');
      }, LAUNCH_TIMEOUT_MS);

      this.client.connect({ host: receiver.host, port: receiver.port }, () => {
        const connection = this.makeChannel(
          'sender-0',
          'receiver-0',
          CONNECTION_NS,
        );
        const heartbeat = this.makeChannel(
          'sender-0',
          'receiver-0',
          HEARTBEAT_NS,
        );
        this.receiverChannel = this.makeChannel(
          'sender-0',
          'receiver-0',
          RECEIVER_NS,
        );
        connection.send({ type: 'CONNECT' });
        heartbeat.send({ type: 'PING' });
        this.heartbeatTimer = setInterval(() => {
          try {
            heartbeat.send({ type: 'PING' });
          } catch {
            /* ignore */
          }
        }, HEARTBEAT_MS);

        let launched = false;
        this.receiverChannel.on('message', (raw) => {
          const data = asRecord(raw);
          if (data?.type !== 'RECEIVER_STATUS') return;
          const status = asRecord(data.status);
          const volume = asRecord(status?.volume);
          if (typeof volume?.level === 'number')
            this.volume.level = volume.level;
          if (typeof volume?.muted === 'boolean')
            this.volume.muted = volume.muted;
          const apps = Array.isArray(status?.applications)
            ? status.applications
            : [];
          // Wait for the requested app. A receiver may report its previous app
          // while LAUNCH is still in flight; attaching to it controls the wrong
          // playback session.
          const app = apps
            .map(asRecord)
            .find((item) => item?.appId === this.appId);
          if (!app) {
            if (launched) {
              this.teardown('stopped');
            } else if (!launch) {
              clearTimeout(timer);
              reject(new Error('No active matching Cast session'));
              this.teardown('disconnected');
            }
            return;
          }
          this.sessionId =
            typeof app.sessionId === 'string' ? app.sessionId : this.sessionId;
          this.displayName =
            typeof app.displayName === 'string'
              ? app.displayName
              : this.displayName;
          this.statusText =
            typeof app.statusText === 'string'
              ? app.statusText
              : this.statusText;
          this.namespaces = Array.isArray(app.namespaces)
            ? app.namespaces.map((ns) => ({
                name: String(asRecord(ns)?.name ?? ns),
              }))
            : [];
          const transportId =
            typeof app.transportId === 'string' ? app.transportId : '';
          if (!launched && transportId) {
            launched = true;
            this.transportId = transportId;
            const transportConnect = this.makeChannel(
              this.senderId,
              transportId,
              CONNECTION_NS,
            );
            transportConnect.send({ type: 'CONNECT' });
            this.status = 'connected';
            clearTimeout(timer);
            this.emitSnapshotIfChanged();
            resolve();
            return;
          }
          this.emitSnapshotIfChanged();
        });

        this.receiverChannel.send({
          type: launch ? 'LAUNCH' : 'GET_STATUS',
          appId: this.appId,
          requestId: this.nextRequestId(),
        });
      });
    });
  }

  sendMessage(namespace: string, message: unknown): void {
    if (!this.transportId) throw new Error('session not connected');
    const channel = this.ensureAppChannel(namespace);
    channel.send(message);
  }

  setVolumeLevel(level: number): void {
    this.receiverChannel?.send({
      type: 'SET_VOLUME',
      volume: { level },
      requestId: this.nextRequestId(),
    });
  }

  setMuted(muted: boolean): void {
    this.receiverChannel?.send({
      type: 'SET_VOLUME',
      volume: { muted },
      requestId: this.nextRequestId(),
    });
  }

  loadMedia(request: unknown): void {
    this.sendMessage(MEDIA_NS, {
      type: 'LOAD',
      requestId: this.nextRequestId(),
      media: asRecord(request)?.media ?? request,
      autoplay: asRecord(request)?.autoplay ?? true,
      currentTime: asRecord(request)?.currentTime ?? 0,
      customData: asRecord(request)?.customData ?? {},
    });
  }

  queueLoad(request: unknown): void {
    const queue = asRecord(request);
    this.sendMessage(MEDIA_NS, {
      ...queue,
      type: 'QUEUE_LOAD',
      requestId: this.nextRequestId(),
    });
  }

  leave(): void {
    this.teardown('disconnected');
  }

  async stop(): Promise<void> {
    if (this.status !== 'connected' || !this.receiverChannel) {
      throw new Error('Cast receiver is not connected');
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        clearInterval(probe);
        this.off('stopped', done);
        reject(new Error('Cast receiver did not confirm stop'));
      }, 5000);
      const probe = setInterval(() => {
        try {
          this.receiverChannel?.send({
            type: 'GET_STATUS',
            requestId: this.nextRequestId(),
          });
        } catch {
          /* retry until the timeout reports the failure */
        }
      }, 1000);
      const done = () => {
        clearTimeout(timer);
        clearInterval(probe);
        if (this.status === 'stopped') resolve();
        else
          reject(new Error('Cast connection ended before stop was confirmed'));
      };
      this.once('stopped', done);
      try {
        this.receiverChannel?.send({
          type: 'STOP',
          sessionId: this.sessionId,
          requestId: this.nextRequestId(),
        });
      } catch (error) {
        clearTimeout(timer);
        clearInterval(probe);
        this.off('stopped', done);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private ensureAppChannel(namespace: string): Channel {
    if (!this.transportId) throw new Error('session not connected');
    const existing = this.channels.get(
      `${this.senderId}:${this.transportId}:${namespace}`,
    );
    if (existing) return existing;
    const channel = this.makeChannel(
      this.senderId,
      this.transportId,
      namespace,
    );
    channel.on('message', (data) => {
      const payload = typeof data === 'string' ? data : JSON.stringify(data);
      this.emit('message', namespace, payload);
    });
    return channel;
  }

  private makeChannel(
    sourceId: string,
    destId: string,
    namespace: string,
  ): Channel {
    const key = `${sourceId}:${destId}:${namespace}`;
    const existing = this.channels.get(key);
    if (existing) return existing;
    const channel = this.client.createChannel(
      sourceId,
      destId,
      namespace,
      'JSON',
    );
    const wrapped: Channel = {
      send: (data) => channel.send(data),
      on: (event, listener) => {
        channel.on(event, (data: unknown) => listener(data));
      },
    };
    this.channels.set(key, wrapped);
    return wrapped;
  }

  private nextRequestId(): number {
    this.requestId += 1;
    return this.requestId;
  }

  private emitSnapshotIfChanged(): void {
    const snap = this.snapshot();
    const key = `${snap.sessionId}|${snap.status}|${snap.statusText ?? ''}|${snap.displayName}|${snap.receiver.volume.level}|${snap.receiver.volume.muted}|${snap.namespaces.map((ns) => ns.name).join(',')}`;
    if (key === this.lastUpdateKey) return;
    this.lastUpdateKey = key;
    this.emit('update');
  }

  private teardown(status: CastSessionSnapshot['status']): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    const was = this.status;
    this.status = status;
    try {
      this.client.close();
    } catch {
      /* ignore */
    }
    if (was !== 'disconnected' && was !== 'stopped') {
      this.emit('stopped');
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}
