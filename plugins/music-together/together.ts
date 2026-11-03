// pear-desktop's Music Together session logic: hosting and joining over PeerJS,
// with YTM's own queue shared (queue.ts). Ported as is so pear-desktop and this
// app can be in the same session.

import type { DataConnection } from "peerjs";
import type { Logger, YTPlayerApi } from "@pear/sdk";
import type { Translate } from "@pear/sdk/i18n";
import type { ConnectionLike } from "./connection.ts";
import { Queue, type QueueElement } from "./queue.ts";
import { type ConnectionEventMap, type ConnectionEventUnion, getDefaultProfile, type Permission, type Profile, type VideoData } from "./types.ts";

/** What the session needs from the page, so tests can fake it. */
export interface TogetherEnvironment {
  createConnection(): ConnectionLike;
  queueElement(): QueueElement | null;
  player(): YTPlayerApi | null;
  /** YTM's toast. */
  toast(message: string): void;
  t: Translate;
  /** The user's name for others (empty: "Guest 1234"). */
  name(): string;
  defaultPermission(): Permission;
  log: Pick<Logger, "warn" | "error">;
}

export type Mode = "disconnected" | "host" | "guest";

/** Seeks closer than this are left alone (pear-desktop's tolerance). */
const SEEK_TOLERANCE_S = 3;
const STATE_INTERVAL_MS = 1000;
const PLAYING = 1;
const PAUSED = 2;
/** How long hosting or joining waits for PeerJS (signalling server, then the host) before failing. */
const CONNECT_TIMEOUT_MS = 20_000;
/** How long after applying a change the player's own events still count as its echo (a frame). */
const SETTLE_MS = 16;

/** What a guest's SYNC_PROGRESS may change on the host; the host's own changes rank above all. */
const PERMISSION_LEVEL: Record<Permission, number> = { "host-only": 0, playlist: 1, all: 2 };
const HOST_LEVEL = 3;
const CONTROLS_QUEUE = 1;
const CONTROLS_PLAYER = 2;

export class Together {
  connection: ConnectionLike | undefined;
  queue: Queue | undefined;
  permission: Permission;
  profiles: Record<string, Profile> = {};
  /** Hosting or joining is under way. */
  connecting = false;
  #env: TogetherEnvironment;
  #me: Omit<Profile, "id"> | undefined;
  #ignoreChange = false;
  /** The queue changed after a track loaded: share the follow-up change too. */
  #shareFollowUp = false;
  #stateTimer: ReturnType<typeof setInterval> | undefined;
  #rollback: (() => void)[] = [];
  #listeners = new Set<() => void>();
  /** Bumped by every host, join and stop: an attempt that sees another number was stopped or superseded. */
  #attempt = 0;

  constructor(env: TogetherEnvironment) {
    this.#env = env;
    this.permission = env.defaultPermission();
  }

  get mode(): Mode {
    return this.connection?.mode ?? "disconnected";
  }

  get id() {
    return this.connection?.id ?? "";
  }

  subscribe(listener: () => void) {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  }

  #emit() {
    for (const listener of this.#listeners) listener();
  }

  #profile(id: string): Profile {
    const name = this.#env.name().trim();
    if (!this.#me) {
      const { id: _, ...me } = getDefaultProfile(id, Date.now().toString(), name || undefined);
      this.#me = me;
    }
    return { id, ...this.#me };
  }

  #putProfile(id: string, profile?: Profile) {
    if (profile === undefined) delete this.profiles[id];
    else this.profiles[id] = profile;
    this.queue?.syncQueueOwner();
    this.#emit();
  }

  #makeQueue() {
    const element = this.#env.queueElement();
    if (!element) return undefined;
    return new Queue({ queue: element, getProfile: (id) => this.profiles[id], t: this.#env.t });
  }

  /** Hosts a session; the id to share is `id`. */
  async host() {
    const attempt = this.#begin();
    try {
      const connection = this.#env.createConnection();
      this.connection = connection;
      const ready = await withTimeout(connection.waitForReady(), CONNECT_TIMEOUT_MS).catch(() => null);
      if (attempt !== this.#attempt) return this.#abandon(connection);
      if (!ready) return this.#fail(this.#env.t("plugins.music-together.toast.host-failed", "Failed to host Music Together"));
      const queue = this.#makeQueue();
      if (!queue) return this.#fail(this.#env.t("plugins.music-together.toast.host-failed", "Failed to host Music Together"));
      this.queue = queue;
      this.profiles = {};
      const me = this.#profile(connection.id);
      this.#putProfile(connection.id, me);
      queue.setOwner(me);
      void queue.setVideoList(
        queue.flatItems.map((item) => ({ videoId: item!.videoId, ownerId: connection.id }) satisfies VideoData),
        false,
      );
      queue.syncQueueOwner();
      queue.initQueue();
      queue.injection();

      connection.onConnections((conn) => {
        // Closing it ourselves (stop) reports once more; that's not news.
        if (this.connection !== connection) return;
        if (!conn) {
          this.#env.toast(this.#env.t("plugins.music-together.toast.disconnected", "Music Together disconnected"));
          return this.stop();
        }
        if (!conn.open) {
          this.#env.toast(this.#env.t("plugins.music-together.toast.user-disconnected", "{{name}} left Music Together", { name: this.profiles[conn.peer]?.name }));
          this.#putProfile(conn.peer, undefined);
        }
      });

      const listener = async (event: ConnectionEventUnion, conn?: DataConnection | null) => {
        this.#ignoreChange = true;
        await this.#onHostEvent(event, conn ?? null, listener);
        if (event.after) {
          const now = event.after.shift();
          if (now) {
            now.after = event.after;
            await listener(now, conn);
          }
        }
      };
      connection.on(listener);
      queue.on(listener);
      setTimeout(() => {
        this.#ignoreChange = false;
      }, SETTLE_MS);
      this.#startSync();
      return true;
    } finally {
      this.#end(attempt);
    }
  }

  /** Starts a host or join attempt, ending whatever session or attempt came before. */
  #begin() {
    if (this.connection) this.stop();
    this.connecting = true;
    this.#emit();
    return ++this.#attempt;
  }

  #end(attempt: number) {
    // A stopped or superseded attempt's `connecting` is no longer its own.
    if (attempt !== this.#attempt) return;
    this.connecting = false;
    this.#emit();
  }

  /**
   * Gives up an attempt that was stopped (or superseded) while it awaited. stop()
   * undid what it had set up by then; the connection may not be the current one.
   */
  #abandon(connection: ConnectionLike) {
    connection.disconnect();
    return false;
  }

  /** Whether a guest's change is refused; the guest then gets the host's queue back. */
  async #refuse(conn: DataConnection | null) {
    if (!conn || this.permission !== "host-only") return false;
    await this.connection?.broadcast("SYNC_QUEUE", { videoList: this.queue?.videoList ?? [] });
    return true;
  }

  async #onHostEvent(event: ConnectionEventUnion, conn: DataConnection | null, listener: (event: ConnectionEventUnion) => void) {
    const connection = this.connection!;
    const queue = this.queue!;
    switch (event.type) {
      case "CLEAR_QUEUE":
        if (await this.#refuse(conn)) return;
        queue.clear();
        await connection.broadcast("CLEAR_QUEUE", null);
        break;
      case "SET_INDEX":
        queue.setIndex(event.payload.index);
        await connection.broadcast("SET_INDEX", { index: event.payload.index });
        break;
      case "ADD_SONGS":
        if (await this.#refuse(conn)) return;
        await this.#hostAddSongs(event, conn);
        break;
      case "REMOVE_SONG":
        if (await this.#refuse(conn)) return;
        queue.removeVideo(event.payload.index);
        await connection.broadcast("REMOVE_SONG", event.payload);
        break;
      case "MOVE_SONG":
        if (await this.#refuse(conn)) return;
        queue.moveItem(event.payload.fromIndex, event.payload.toIndex);
        await connection.broadcast("MOVE_SONG", event.payload);
        break;
      case "IDENTIFY":
        if (!event.payload || !conn) break;
        this.#env.toast(this.#env.t("plugins.music-together.toast.user-connected", "{{name}} joined Music Together", { name: event.payload.profile.name }));
        this.#putProfile(conn.peer, event.payload.profile);
        break;
      case "SYNC_PROFILE":
        await connection.broadcast("SYNC_PROFILE", { profiles: this.profiles });
        break;
      case "PERMISSION":
        await connection.broadcast("PERMISSION", this.permission);
        break;
      case "SYNC_QUEUE":
        await connection.broadcast("SYNC_QUEUE", { videoList: queue.videoList });
        break;
      case "SYNC_PROGRESS": {
        const level = conn ? PERMISSION_LEVEL[this.permission] : HOST_LEVEL;
        if (level >= CONTROLS_PLAYER) this.#applyProgress(event.payload);
        if (level >= CONTROLS_QUEUE) this.#followIndex(event.payload);
        break;
      }
      case "CONNECTION_CLOSED":
        queue.off(listener);
        break;
    }
  }

  async #hostAddSongs(event: Extract<ConnectionEventUnion, { type: "ADD_SONGS" }>, conn: DataConnection | null) {
    const connection = this.connection!;
    const queue = this.queue!;
    const videoList = event.payload.videoList.map((video) => ({ ...video, ownerId: video.ownerId ?? conn?.peer ?? connection.id }));
    await queue.addVideos(videoList, event.payload.index);
    await connection.broadcast("ADD_SONGS", { ...event.payload, videoList }, event.after);
    const after = event.after?.at(0);
    if (after?.type === "SET_INDEX") queue.setIndex(after.payload.index);
  }

  /** Selects the queue item another side is playing. */
  #followIndex(payload: ConnectionEventMap["SYNC_PROGRESS"]) {
    const queue = this.queue!;
    if (typeof payload?.index === "number" && queue.selectedIndex !== payload.index) queue.setIndex(payload.index);
  }

  #applyProgress(payload: { progress?: number; state?: number } | undefined) {
    const player = this.#env.player();
    if (!player) return;
    if (typeof payload?.progress === "number" && Math.abs(payload.progress - player.getCurrentTime()) > SEEK_TOLERANCE_S) {
      player.seekTo(payload.progress);
    }
    if (player.getPlayerState() !== payload?.state) {
      if (payload?.state === PAUSED) player.pauseVideo();
      if (payload?.state === PLAYING) player.playVideo();
    }
  }

  /** Joins the session hosted under `hostId` (the host's PeerJS id). */
  async join(hostId: string) {
    const attempt = this.#begin();
    const failed = () => this.#fail(this.#env.t("plugins.music-together.toast.join-failed", "Failed to join Music Together"));
    try {
      const connection = this.#env.createConnection();
      this.connection = connection;
      const ready = await withTimeout(connection.waitForReady(), CONNECT_TIMEOUT_MS).catch(() => null);
      if (attempt !== this.#attempt) return this.#abandon(connection);
      if (!ready) return failed();
      this.profiles = {};
      const id = hostId.trim();
      if (!id) return failed();
      const connected = await withTimeout(connection.connect(id), CONNECT_TIMEOUT_MS).then(() => true, () => false);
      if (attempt !== this.#attempt) return this.#abandon(connection);
      if (!connected) return failed();
      const queue = this.#makeQueue();
      if (!queue) return failed();
      this.queue = queue;
      connection.onConnections((conn) => {
        if (this.connection !== connection) return;
        if (!conn?.open) {
          this.#env.toast(this.#env.t("plugins.music-together.toast.disconnected", "Music Together disconnected"));
          this.stop();
        }
      });

      let resolveIgnore: ReturnType<typeof setTimeout> | undefined;
      const settle = () => {
        clearTimeout(resolveIgnore);
        resolveIgnore = setTimeout(() => {
          this.#ignoreChange = false;
        }, SETTLE_MS);
      };
      // Changes made in this window's YTM go to the host, which applies them for everyone.
      const queueListener = async (event: ConnectionEventUnion) => {
        this.#ignoreChange = true;
        await this.#sendToHost(connection, event);
        settle();
      };
      // The host's changes, applied here.
      const listener = async (event: ConnectionEventUnion) => {
        this.#ignoreChange = true;
        if (event.type === "CONNECTION_CLOSED") queue.off(queueListener);
        else await this.#applyFromHost(connection, queue, event);
        settle();
      };
      connection.on(listener);
      queue.on(queueListener);

      const me = this.#profile(connection.id);
      queue.injection();
      queue.setOwner(me);
      this.#watchSeeks();

      // Stopped while these went out: leave YTM's queue alone and start no sync.
      await connection.broadcast("IDENTIFY", { profile: me });
      if (attempt !== this.#attempt) return this.#abandon(connection);
      await connection.broadcast("SYNC_PROFILE", undefined);
      if (attempt !== this.#attempt) return this.#abandon(connection);
      await connection.broadcast("PERMISSION", undefined);
      if (attempt !== this.#attempt) return this.#abandon(connection);
      queue.clear();
      queue.syncQueueOwner();
      queue.initQueue();
      await connection.broadcast("SYNC_QUEUE", undefined);
      if (attempt !== this.#attempt) return this.#abandon(connection);
      this.#startSync();
      return true;
    } finally {
      this.#end(attempt);
    }
  }

  /** A guest's own queue change, sent to the host. */
  async #sendToHost(connection: ConnectionLike, event: ConnectionEventUnion) {
    switch (event.type) {
      case "CLEAR_QUEUE":
        return connection.broadcast("CLEAR_QUEUE", null);
      case "SET_INDEX":
        return connection.broadcast("SET_INDEX", { index: event.payload.index });
      case "ADD_SONGS": {
        const videoList = event.payload.videoList.map((video) => ({ ...video, ownerId: video.ownerId ?? connection.id }));
        return connection.broadcast("ADD_SONGS", { ...event.payload, videoList }, event.after);
      }
      case "REMOVE_SONG":
        return connection.broadcast("REMOVE_SONG", event.payload);
      case "MOVE_SONG":
        return connection.broadcast("MOVE_SONG", event.payload);
      case "SYNC_PROGRESS":
        if (this.permission === "host-only") return connection.broadcast("SYNC_QUEUE", undefined);
        return connection.broadcast("SYNC_PROGRESS", event.payload);
    }
  }

  /** A change from the host, applied to this guest's queue and player. */
  async #applyFromHost(connection: ConnectionLike, queue: Queue, event: ConnectionEventUnion) {
    switch (event.type) {
      case "CLEAR_QUEUE":
        return queue.clear();
      case "SET_INDEX":
        return queue.setIndex(event.payload.index);
      case "ADD_SONGS": {
        const videoList = event.payload.videoList.map((video) => ({ ...video, ownerId: video.ownerId ?? connection.id }));
        await queue.addVideos(videoList, event.payload.index);
        const after = event.after?.at(0);
        if (after?.type === "SET_INDEX") queue.setIndex(after.payload.index);
        return;
      }
      case "REMOVE_SONG":
        return queue.removeVideo(event.payload.index);
      case "MOVE_SONG":
        return queue.moveItem(event.payload.fromIndex, event.payload.toIndex);
      case "SYNC_QUEUE":
        if (Array.isArray(event.payload?.videoList)) await queue.setVideoList(event.payload.videoList);
        return;
      case "SYNC_PROFILE":
        if (!event.payload) return;
        for (const [id, profile] of Object.entries(event.payload.profiles)) this.#putProfile(id, profile);
        return;
      case "SYNC_PROGRESS":
        this.#applyProgress(event.payload);
        this.#followIndex(event.payload);
        return;
      case "PERMISSION":
        if (!event.payload) return;
        this.permission = event.payload;
        this.#toastPermission(this.permission);
        this.#emit();
        return;
    }
  }

  #toastPermission(permission: Permission) {
    this.#env.toast(
      this.#env.t("plugins.music-together.toast.permission-changed", 'Music Together permission changed to "{{permission}}"', {
        permission: this.permissionLabel(permission),
      }),
    );
  }

  /** A guest with full control seeking with YTM's progress bar tells the host. */
  #watchSeeks() {
    for (const progress of document.querySelectorAll<HTMLElement & { _update?: (...args: unknown[]) => void }>("tp-yt-paper-progress")) {
      const original = progress._update;
      if (!original) continue;
      progress._update = (...args: unknown[]) => {
        const now = args[0];
        const player = this.#env.player();
        const seeked = typeof now === "number" && !!player && Math.abs(now - player.getCurrentTime()) > SEEK_TOLERANCE_S;
        if (this.permission === "all" && seeked) {
          void this.connection?.broadcast("SYNC_PROGRESS", { progress: now, state: player.getPlayerState() });
        }
        original.call(progress, ...args);
      };
      this.#rollback.push(() => (progress._update = original));
    }
  }

  /** The host's position, state and queue index go out every second; guests with control send play/pause. */
  #startSync() {
    const player = this.#env.player();
    this.#stateTimer = setInterval(() => {
      if (this.connection?.mode !== "host") return;
      const api = this.#env.player();
      void this.connection.broadcast("SYNC_PROGRESS", {
        ...(api ? { progress: api.getCurrentTime(), state: api.getPlayerState() } : {}),
        index: Math.max(0, this.queue?.selectedIndex ?? 0),
      });
    }, STATE_INTERVAL_MS);
    if (!player) return;
    const onState = () => {
      if (this.connection?.mode !== "guest" || this.#ignoreChange || this.permission !== "all") return;
      const state = player.getPlayerState();
      if (state !== PLAYING && state !== PAUSED) return;
      void this.connection.broadcast("SYNC_PROGRESS", { state });
    };
    // The host shares its queue as YTM loads new tracks into it.
    const onVideoData = (name: string) => {
      if (name !== "dataloaded" && !this.#shareFollowUp) return;
      if (this.connection?.mode !== "host" || !this.queue) return;
      const connection = this.connection;
      const videoList = this.queue.flatItems.map(
        (item, index) => ({ videoId: item!.videoId, ownerId: this.queue?.videoList[index]?.ownerId ?? connection.id }) satisfies VideoData,
      );
      void this.queue.setVideoList(videoList, false);
      this.queue.syncQueueOwner();
      void connection.broadcast("SYNC_QUEUE", { videoList });
      this.#shareFollowUp = name === "dataloaded";
    };
    player.addEventListener("onStateChange", onState);
    player.addEventListener("videodatachange", onVideoData);
    this.#rollback.push(() => {
      player.removeEventListener("onStateChange", onState);
      player.removeEventListener("videodatachange", onVideoData);
    });
  }

  /** The host changes what guests may do. */
  async setPermission(permission: Permission) {
    this.permission = permission;
    await this.connection?.broadcast("PERMISSION", permission);
    this.#toastPermission(permission);
    this.#emit();
  }

  permissionLabel(permission: Permission) {
    switch (permission) {
      case "host-only":
        return this.#env.t("plugins.music-together.menu.permission.host-only", "Only the host can control playlist and player");
      case "playlist":
        return this.#env.t("plugins.music-together.menu.permission.playlist", "Allow guests to control playlist");
      case "all":
        return this.#env.t("plugins.music-together.menu.permission.all", "Allow guests to control playlist and player");
    }
  }

  stop() {
    this.#attempt++;
    this.connecting = false;
    const connection = this.connection;
    this.connection = undefined;
    // Even "disconnected": a host or join still waiting for PeerJS has a Peer that would keep reconnecting.
    connection?.disconnect();
    clearInterval(this.#stateTimer);
    this.#stateTimer = undefined;
    this.queue?.rollbackInjection();
    this.queue?.removeQueueOwner();
    this.queue = undefined;
    for (const rollback of this.#rollback.splice(0)) rollback();
    this.profiles = {};
    this.permission = this.#env.defaultPermission();
    this.#emit();
  }

  #fail(message: string) {
    this.#env.toast(message);
    this.stop();
    return false;
  }
}

/** `promise`, or a rejection after `ms`: PeerJS may never open, e.g. without a signalling server. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
