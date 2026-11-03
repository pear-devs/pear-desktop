// pear-desktop's PeerJS connection: the host's id is its raw PeerJS id, and
// events travel as { type, payload, after }.

import {
  type BaseConnectionErrorType,
  type DataConnection,
  type DataConnectionErrorType,
  Peer,
  type PeerError,
  PeerErrorType,
} from "peerjs";
import type { Logger } from "@pear/sdk";
import { sleep } from "@pear/sdk/util";
import type { ConnectionEventMap, ConnectionEventUnion } from "./types.ts";

export type ConnectionListener = (event: ConnectionEventUnion, conn: DataConnection | null) => void;
export type ConnectionMode = "host" | "guest" | "disconnected";

/** The parts of a connection the session logic uses (a fake one in tests). */
export interface ConnectionLike {
  readonly id: string;
  readonly mode: ConnectionMode;
  waitForReady(): Promise<string>;
  connect(id: string): Promise<unknown>;
  disconnect(): void;
  broadcast<Event extends keyof ConnectionEventMap>(type: Event, payload: ConnectionEventMap[Event], after?: ConnectionEventUnion[]): Promise<void>;
  on(listener: ConnectionListener): void;
  onConnections(listener: (connection?: DataConnection) => void): void;
}

const RECOVERABLE_PEER_ERRORS = new Set<string>([
  PeerErrorType.Network,
  PeerErrorType.ServerError,
  PeerErrorType.SocketError,
  PeerErrorType.SocketClosed,
]);

export class Connection implements ConnectionLike {
  private peer: Peer;
  private _mode: ConnectionMode = "disconnected";
  private connections: Record<string, DataConnection> = {};
  private isDestroyed = false;
  private isReconnecting = false;
  private waitOpen: { promise: Promise<string>; resolve(id: string): void; reject(error: unknown): void };
  private listeners: ConnectionListener[] = [];
  private connectionListeners: ((connection?: DataConnection) => void)[] = [];

  constructor(private log: Pick<Logger, "warn" | "error">) {
    this.peer = new Peer({
      debug: 0,
      config: {
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: ["turn:eu-0.turn.peerjs.com:3478", "turn:us-0.turn.peerjs.com:3478"], username: "peerjs", credential: "peerjsp" },
          { urls: "stun:freestun.net:3478" },
          { urls: "turn:freestun.net:3478", username: "free", credential: "free" },
        ],
        sdpSemantics: "unified-plan",
      },
    });

    let resolve!: (id: string) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<string>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    promise.catch(() => {});
    this.waitOpen = { promise, resolve, reject };

    this.peer.on("open", (id) => {
      if (this._mode === "disconnected") this._mode = "host";
      this.waitOpen.resolve(id);
    });
    this.peer.on("connection", async (conn) => {
      this._mode = "host";
      try {
        await this.registerConnection(conn);
      } catch {
        // The guest went away before the connection opened.
      }
    });
    this.peer.on("disconnected", async () => {
      if (this.isDestroyed) return;
      this.log.warn("lost the signalling server, reconnecting");
      await this.reconnectLoop();
    });
    this.peer.on("close", () => this.cleanup());
    this.peer.on("error", async (err) => {
      if (!this.isDestroyed && RECOVERABLE_PEER_ERRORS.has(err.type)) {
        this.log.warn("recoverable peer error", err.type);
        await this.reconnectLoop();
        return;
      }
      if (err.type === "peer-unavailable") return;
      if (err.type === "unavailable-id") {
        this.log.warn("id no longer available, staying on existing connections");
        this.isReconnecting = false;
        return;
      }
      this.log.error("fatal peer error", err);
      this.waitOpen.reject(err);
      this.disconnect();
    });
  }

  waitForReady() {
    return this.waitOpen.promise;
  }

  async connect(id: string) {
    this._mode = "guest";
    const conn = this.peer.connect(id, { reliable: true });
    const unavailable = new Promise<never>((_, reject) => {
      const onError = (err: PeerError<`${PeerErrorType}`>) => {
        if (err.type === "peer-unavailable") {
          this.peer.off("error", onError);
          reject(err);
        }
      };
      this.peer.on("error", onError);
      conn.once("open", () => this.peer.off("error", onError));
      conn.once("close", () => this.peer.off("error", onError));
    });
    await Promise.race([this.registerConnection(conn), unavailable]);
    return conn;
  }

  disconnect() {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.isReconnecting = false;
    this._mode = "disconnected";
    for (const conn of this.getConnections()) conn.close({ flush: true });
    if (!this.peer.destroyed) this.peer.destroy();
    else this.cleanup();
  }

  get id() {
    return this.peer.id;
  }

  get mode() {
    return this._mode;
  }

  getConnections() {
    return Object.values(this.connections);
  }

  async broadcast<Event extends keyof ConnectionEventMap>(type: Event, payload: ConnectionEventMap[Event], after?: ConnectionEventUnion[]) {
    await Promise.all(this.getConnections().map((conn) => conn.send({ type, payload, after }) ?? Promise.resolve()));
  }

  on(listener: ConnectionListener) {
    if (!this.listeners.includes(listener)) this.listeners.push(listener);
  }

  onConnections(listener: (connection?: DataConnection) => void) {
    this.connectionListeners.push(listener);
  }

  private async reconnectLoop() {
    if (this.isDestroyed || this.isReconnecting || this.peer.destroyed) return;
    this.isReconnecting = true;
    let attempt = 0;
    while (!this.isDestroyed && this.peer.disconnected && !this.peer.destroyed) {
      attempt += 1;
      const backoff = Math.min(30_000, 1_000 * 2 ** (attempt - 1));
      try {
        this.peer.reconnect();
      } catch (error) {
        this.log.error("reconnect failed", error);
      }
      await sleep(backoff);
    }
    this.isReconnecting = false;
  }

  private cleanup() {
    this._mode = "disconnected";
    this.connections = {};
    for (const listener of this.listeners) listener({ type: "CONNECTION_CLOSED", payload: null }, null);
    this.listeners = [];
    for (const listener of this.connectionListeners) listener();
    this.connectionListeners = [];
  }

  private registerConnection(conn: DataConnection) {
    return new Promise<DataConnection>((resolve, reject) => {
      conn.on("open", () => {
        this.connections[conn.connectionId] = conn;
        resolve(conn);
        for (const listener of this.connectionListeners) listener(conn);
        conn.on("data", (data) => {
          if (!isEvent(data)) {
            this.log.warn("invalid data", data);
            return;
          }
          for (const listener of this.listeners) listener(data, conn);
        });
      });
      const onClose = (err?: PeerError<`${DataConnectionErrorType | BaseConnectionErrorType}`>) => {
        if (conn.open) conn.close();
        delete this.connections[conn.connectionId];
        if (err) {
          if (err.type === "connection-closed") for (const listener of this.connectionListeners) listener();
          reject(err);
        } else {
          for (const listener of this.connectionListeners) listener(conn);
        }
      };
      conn.on("error", onClose);
      conn.on("close", () => onClose());
    });
  }
}

/** A `{ type, payload }` message; its payload is trusted as pear-desktop's. */
function isEvent(data: unknown): data is ConnectionEventUnion {
  return !!data && typeof data === "object" && "type" in data && "payload" in data && !!data.type;
}
