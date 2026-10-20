// pear-desktop's Music Together session logic: hosting and joining over PeerJS,
// with YTM's own queue shared (queue.ts). Ported as is so pear-desktop and this
// app can be in the same session.

import type { DataConnection } from "peerjs";
import type { YTPlayerApi } from "@pear/sdk";
import type { ConnectionLike } from "./connection.ts";
import { Queue, type QueueElement } from "./queue.ts";
import { type ConnectionEventUnion, getDefaultProfile, type Permission, type Profile, type VideoData } from "./types.ts";

type Translate = (key: string, fallback: string, vars?: Record<string, unknown>) => string;

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
  log: { warn(...args: unknown[]): void; error(...args: unknown[]): void };
}

export type Mode = "disconnected" | "host" | "guest";

/** Seeks closer than this are left alone (pear-desktop's tolerance). */
const SEEK_TOLERANCE_S = 3;
const STATE_INTERVAL_MS = 1000;
const PLAYING = 1;
const PAUSED = 2;

export class Together {
  connection: ConnectionLike | undefined;
  queue: Queue | undefined;
  permission: Permission;
  profiles: Record<string, Profile> = {};
  busy = false;
  #env: TogetherEnvironment;
  #me: Omit<Profile, "id"> | undefined;
  #ignoreChange = false;
  #updateNext = false;
  #stateTimer: ReturnType<typeof setInterval> | undefined;
  #rollback: (() => void)[] = [];
  #listeners = new Set<() => void>();

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
    this.#me ??= (({ id: _, ...rest }) => rest)(getDefaultProfile(id, Date.now().toString(), name || undefined));
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
    this.busy = true;
    this.#emit();
    try {
      const connection = this.#env.createConnection();
      this.connection = connection;
      if (!(await connection.waitForReady().catch(() => null))) return this.#fail("host-failed", "Failed to host Music Together");
      const queue = this.#makeQueue();
      if (!queue) return this.#fail("host-failed", "Failed to host Music Together");
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
      setTimeout(() => (this.#ignoreChange = false), 16);
      this.#startSync();
      return true;
    } finally {
      this.busy = false;
      this.#emit();
    }
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
      case "ADD_SONGS": {
        if (await this.#refuse(conn)) return;
        const videoList = event.payload.videoList.map((video) => ({ ...video, ownerId: video.ownerId ?? conn?.peer ?? connection.id }));
        await queue.addVideos(videoList, event.payload.index);
        await connection.broadcast("ADD_SONGS", { ...event.payload, videoList }, event.after);
        const after = event.after?.at(0);
        if (after?.type === "SET_INDEX") queue.setIndex(after.payload.index);
        break;
      }
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
        // 3: the host's own change; 2: guests control the player; 1: the queue; 0: nothing.
        const level = !conn ? 3 : this.permission === "all" ? 2 : this.permission === "playlist" ? 1 : 0;
        if (level >= 2) this.#applyProgress(event.payload);
        if (level >= 1 && typeof event.payload?.index === "number" && queue.selectedIndex !== event.payload.index) {
          queue.setIndex(event.payload.index);
        }
        break;
      }
      case "CONNECTION_CLOSED":
        queue.off(listener);
        break;
    }
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
    this.busy = true;
    this.#emit();
    try {
      const connection = this.#env.createConnection();
      this.connection = connection;
      if (!(await connection.waitForReady().catch(() => null))) return this.#fail("join-failed", "Failed to join Music Together");
      this.profiles = {};
      const id = hostId.trim();
      if (!id || !(await connection.connect(id).then(() => true, () => false))) return this.#fail("join-failed", "Failed to join Music Together");
      const queue = this.#makeQueue();
      if (!queue) return this.#fail("join-failed", "Failed to join Music Together");
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
        resolveIgnore = setTimeout(() => (this.#ignoreChange = false), 16);
      };
      // Changes made in this window's YTM go to the host, which applies them for everyone.
      const queueListener = async (event: ConnectionEventUnion) => {
        this.#ignoreChange = true;
        switch (event.type) {
          case "CLEAR_QUEUE":
            await connection.broadcast("CLEAR_QUEUE", null);
            break;
          case "SET_INDEX":
            await connection.broadcast("SET_INDEX", { index: event.payload.index });
            break;
          case "ADD_SONGS":
            await connection.broadcast(
              "ADD_SONGS",
              { ...event.payload, videoList: event.payload.videoList.map((video) => ({ ...video, ownerId: video.ownerId ?? connection.id })) },
              event.after,
            );
            break;
          case "REMOVE_SONG":
            await connection.broadcast("REMOVE_SONG", event.payload);
            break;
          case "MOVE_SONG":
            await connection.broadcast("MOVE_SONG", event.payload);
            break;
          case "SYNC_PROGRESS":
            if (this.permission === "host-only") await connection.broadcast("SYNC_QUEUE", undefined);
            else await connection.broadcast("SYNC_PROGRESS", event.payload);
            break;
        }
        settle();
      };
      // The host's changes, applied here.
      const listener = async (event: ConnectionEventUnion) => {
        this.#ignoreChange = true;
        switch (event.type) {
          case "CLEAR_QUEUE":
            queue.clear();
            break;
          case "SET_INDEX":
            queue.setIndex(event.payload.index);
            break;
          case "ADD_SONGS": {
            const videoList = event.payload.videoList.map((video) => ({ ...video, ownerId: video.ownerId ?? connection.id }));
            await queue.addVideos(videoList, event.payload.index);
            const after = event.after?.at(0);
            if (after?.type === "SET_INDEX") queue.setIndex(after.payload.index);
            break;
          }
          case "REMOVE_SONG":
            queue.removeVideo(event.payload.index);
            break;
          case "MOVE_SONG":
            queue.moveItem(event.payload.fromIndex, event.payload.toIndex);
            break;
          case "SYNC_QUEUE":
            if (Array.isArray(event.payload?.videoList)) await queue.setVideoList(event.payload.videoList);
            break;
          case "SYNC_PROFILE":
            if (!event.payload) break;
            for (const [id, profile] of Object.entries(event.payload.profiles)) this.#putProfile(id, profile);
            break;
          case "SYNC_PROGRESS":
            this.#applyProgress(event.payload);
            if (typeof event.payload?.index === "number" && queue.selectedIndex !== event.payload.index) queue.setIndex(event.payload.index);
            break;
          case "PERMISSION": {
            if (!event.payload) break;
            this.permission = event.payload;
            this.#env.toast(
              this.#env.t("plugins.music-together.toast.permission-changed", 'Music Together permission changed to "{{permission}}"', {
                permission: this.permissionLabel(this.permission),
              }),
            );
            this.#emit();
            break;
          }
          case "CONNECTION_CLOSED":
            queue.off(queueListener);
            break;
        }
        settle();
      };
      connection.on(listener);
      queue.on(queueListener);

      const me = this.#profile(connection.id);
      queue.injection();
      queue.setOwner(me);
      this.#watchSeeks();

      await connection.broadcast("IDENTIFY", { profile: me });
      await connection.broadcast("SYNC_PROFILE", undefined);
      await connection.broadcast("PERMISSION", undefined);
      queue.clear();
      queue.syncQueueOwner();
      queue.initQueue();
      await connection.broadcast("SYNC_QUEUE", undefined);
      this.#startSync();
      return true;
    } finally {
      this.busy = false;
      this.#emit();
    }
  }

  /** A guest with full control seeking with YTM's progress bar tells the host. */
  #watchSeeks() {
    for (const progress of document.querySelectorAll<HTMLElement & { _update?: (...args: unknown[]) => void }>("tp-yt-paper-progress")) {
      const original = progress._update;
      if (!original) continue;
      progress._update = (...args: unknown[]) => {
        const now = args[0];
        const player = this.#env.player();
        if (this.permission === "all" && typeof now === "number" && player && Math.abs(now - player.getCurrentTime()) > SEEK_TOLERANCE_S) {
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
      if (name !== "dataloaded" && !this.#updateNext) return;
      if (this.connection?.mode !== "host" || !this.queue) return;
      const connection = this.connection;
      const videoList = this.queue.flatItems.map(
        (item, index) => ({ videoId: item!.videoId, ownerId: this.queue?.videoList[index]?.ownerId ?? connection.id }) satisfies VideoData,
      );
      void this.queue.setVideoList(videoList, false);
      this.queue.syncQueueOwner();
      void connection.broadcast("SYNC_QUEUE", { videoList });
      this.#updateNext = name === "dataloaded";
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
    this.#env.toast(
      this.#env.t("plugins.music-together.toast.permission-changed", 'Music Together permission changed to "{{permission}}"', { permission: this.permissionLabel(permission) }),
    );
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
    const connection = this.connection;
    this.connection = undefined;
    if (connection && connection.mode !== "disconnected") connection.disconnect();
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

  #fail(key: string, fallback: string) {
    this.#env.toast(this.#env.t(`plugins.music-together.toast.${key}`, fallback));
    this.stop();
    return false;
  }
}
