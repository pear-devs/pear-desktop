// Session logic, independent of PeerJS and of YTM: a host that owns the room
// and broadcasts its playback, and guests that mirror it. Tested with in-memory
// links and fake players.

import { interpolate, type Translate } from "@pear/sdk/i18n";
import {
  HOST_ID,
  isGuestMessage,
  isHostMessage,
  type GuestAction,
  type GuestMessage,
  type HostMessage,
  type Participant,
  type Permission,
  type Playback,
  type QueueItem,
  type RoomState,
} from "./protocol.ts";

/** What a session needs from the local player. */
export interface LocalPlayback {
  videoId: string;
  title: string;
  artist: string;
  artworkUrl?: string;
  durationSeconds: number;
  playing: boolean;
  /** Seconds, as of now. */
  position: number;
  /** An ad plays instead of the track; nothing can be synced meanwhile. */
  ad: boolean;
  ended: boolean;
}

export interface PlayerPort {
  snapshot(): LocalPlayback | null;
  load(videoId: string): void;
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  next(): void;
  /** Called on track, play/pause and seek changes (not on every time update). */
  subscribe(listener: () => void): () => void;
}

/** A reliable, ordered message channel to one peer. */
export interface Link {
  readonly peerId: string;
  send(message: unknown): void;
  onMessage(listener: (message: unknown) => void): void;
  onClose(listener: () => void): void;
  close(): void;
}

export type TrackInfo = { title: string; artist: string };

/** Guests further off than this get seeked. */
export const DRIFT_SECONDS = 2;
const HEARTBEAT_MS = 2000;
const PING_MS = 5000;
/** Player changes right after we commanded the player are ours, not the user's. */
const OWN_CHANGE_MS = 1500;
/** A load that hasn't happened by then is retried. */
const LOAD_TIMEOUT_MS = 15_000;
/** After a guest asked the host for something, give the host time to act before enforcing its state again. */
const REQUEST_GRACE_MS = 2500;
const MAX_NAME = 32;
const MAX_QUEUE = 100;

/** English with `{{var}}` placeholders filled in: the default when no translator is given. */
const english: Translate = (key, fallback, vars) => interpolate(fallback ?? key, vars);
const NOTICE_PREFIX = "plugins.music-together.";

abstract class Observable {
  #listeners = new Set<() => void>();
  #toastListeners = new Set<(text: string) => void>();

  subscribe(listener: () => void) {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  }

  onToast(listener: (text: string) => void) {
    this.#toastListeners.add(listener);
    return () => void this.#toastListeners.delete(listener);
  }

  protected changed() {
    for (const listener of this.#listeners) listener();
  }

  protected toast(text: string) {
    for (const listener of this.#toastListeners) listener(text);
  }
}

export function toPlayback(local: LocalPlayback | null): Playback | null {
  if (!local) return null;
  const playback: Playback = {
    videoId: local.videoId,
    title: local.title,
    artist: local.artist,
    durationSeconds: local.durationSeconds,
    // Guests wait while the host sits through an ad.
    playing: local.playing && !local.ad,
    position: local.position,
  };
  if (local.artworkUrl) playback.artworkUrl = local.artworkUrl;
  return playback;
}

// ---------------------------------------------------------------- host

interface Guest {
  link: Link;
  name?: string;
}

export class HostSession extends Observable {
  readonly role = "host";
  permission: Permission;
  queue: QueueItem[] = [];
  #name: string;
  #guests = new Map<string, Guest>();
  #player: PlayerPort;
  #resolve: (videoId: string) => Promise<TrackInfo>;
  #nextItemId = 1;
  #lastSent: Playback | null = null;
  #lastSentAt = 0;
  #cleanups: (() => void)[] = [];
  #closed = false;
  #t: Translate;

  constructor(options: {
    player: PlayerPort;
    name: string;
    permission: Permission;
    resolve: (videoId: string) => Promise<TrackInfo>;
    t?: Translate;
  }) {
    super();
    this.#t = options.t ?? english;
    this.#player = options.player;
    this.#name = options.name;
    this.permission = options.permission;
    this.#resolve = options.resolve;
    this.#cleanups.push(options.player.subscribe(() => this.#onPlayerChange()));
    const heartbeat = setInterval(() => this.#broadcastPlayback(true), HEARTBEAT_MS);
    this.#cleanups.push(() => clearInterval(heartbeat));
  }

  get participants(): Participant[] {
    const guests = [...this.#guests].filter(([, g]) => g.name).map(([id, g]) => ({ id, name: g.name! }));
    return [{ id: HOST_ID, name: this.#name }, ...guests];
  }

  get room(): RoomState {
    return { permission: this.permission, participants: this.participants, queue: this.queue };
  }

  addLink(link: Link) {
    if (this.#closed) return link.close();
    const guest: Guest = { link };
    this.#guests.set(link.peerId, guest);
    link.onMessage((message) => {
      if (isGuestMessage(message)) void this.#handle(link.peerId, guest, message);
    });
    link.onClose(() => {
      if (!this.#guests.delete(link.peerId) || !guest.name) return;
      this.toast(this.#t("plugins.music-together.toast.user-disconnected", "{{name}} left Music Together", { name: guest.name }));
      this.#broadcastRoom();
    });
  }

  setName(name: string) {
    this.#name = cleanName(name) || this.#name;
    this.#broadcastRoom();
  }

  setPermission(permission: Permission) {
    this.permission = permission;
    this.#broadcastRoom();
  }

  /** Adds a track to the room queue (the host's own additions use this too). */
  async suggest(videoId: string, by = HOST_ID) {
    const from = this.participants.find((p) => p.id === by)?.name ?? this.#t("plugins.music-together.internal.unknown-user", "Unknown User");
    if (this.queue.some((item) => item.videoId === videoId)) {
      return this.#notice(by, (t) => t("plugins.music-together.toast.already-queued", "That song is already in the queue"));
    }
    if (this.queue.length >= MAX_QUEUE) return this.#notice(by, (t) => t("plugins.music-together.toast.queue-full", "The queue is full"));
    const info = await this.#resolve(videoId).catch(() => ({ title: videoId, artist: "" }));
    if (this.#closed) return;
    this.queue = [...this.queue, { id: String(this.#nextItemId++), videoId, ...info, by }];
    if (by !== HOST_ID) this.toast(this.#t("plugins.music-together.toast.suggested", "{{name}} suggested {{title}}", { name: from, title: info.title }));
    this.#broadcastRoom();
  }

  playItem(id: string) {
    const item = this.queue.find((i) => i.id === id);
    if (!item) return;
    this.queue = this.queue.filter((i) => i !== item);
    this.#player.load(item.videoId);
    this.#broadcastRoom();
  }

  removeItem(id: string) {
    this.queue = this.queue.filter((i) => i.id !== id);
    this.#broadcastRoom();
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    for (const { link } of this.#guests.values()) {
      link.send({ type: "closed" } satisfies HostMessage);
      link.close();
    }
    this.#guests.clear();
    for (const cleanup of this.#cleanups) cleanup();
    this.changed();
  }

  async #handle(peerId: string, guest: Guest, message: GuestMessage) {
    if (message.type === "hello") {
      const first = !guest.name;
      guest.name = cleanName(message.name) || `Guest ${peerId.slice(-4)}`;
      guest.link.send({
        type: "welcome",
        you: peerId,
        host: this.#name,
        room: this.room,
        playback: toPlayback(this.#player.snapshot()),
      } satisfies HostMessage);
      if (first) this.toast(this.#t("plugins.music-together.toast.user-connected", "{{name}} joined Music Together", { name: guest.name }));
      return this.#broadcastRoom();
    }
    if (!guest.name) return;
    switch (message.type) {
      case "ping":
        return guest.link.send({ type: "pong", t: message.t } satisfies HostMessage);
      case "suggest":
        if (this.permission === "host-only") return this.#notice(peerId, (t) => t("plugins.music-together.toast.no-suggestions", "The host isn't taking suggestions"));
        return this.suggest(message.videoId, peerId);
      case "control":
        return this.#control(peerId, message.action);
    }
  }

  #control(peerId: string, action: GuestAction) {
    const own = action.type === "removeItem" && this.queue.find((i) => i.id === action.id)?.by === peerId;
    if (this.permission !== "control" && !own) {
      // Resend the truth so the guest's player snaps back.
      this.#notice(peerId, (t) => t("plugins.music-together.toast.host-controls", "Only the host controls playback"));
      return this.#guests.get(peerId)?.link.send({
        type: "playback",
        playback: toPlayback(this.#player.snapshot()),
      } satisfies HostMessage);
    }
    switch (action.type) {
      case "play":
        return this.#player.play();
      case "pause":
        return this.#player.pause();
      case "seek":
        return this.#player.seek(action.seconds);
      case "next":
        return this.queue[0] ? this.playItem(this.queue[0].id) : this.#player.next();
      case "load":
        return this.#player.load(action.videoId);
      case "playItem":
        return this.playItem(action.id);
      case "removeItem":
        return this.removeItem(action.id);
    }
  }

  #onPlayerChange() {
    const local = this.#player.snapshot();
    // The room queue plays before YTM's own up-next.
    if (local?.ended && this.queue[0]) return this.playItem(this.queue[0].id);
    this.#broadcastPlayback(false);
    this.changed();
  }

  #broadcastPlayback(heartbeat: boolean) {
    const playback = toPlayback(this.#player.snapshot());
    if (!heartbeat && samePlayback(this.#lastSent, playback, (Date.now() - this.#lastSentAt) / 1000)) return;
    this.#lastSent = playback;
    this.#lastSentAt = Date.now();
    this.#broadcast({ type: "playback", playback });
  }

  #broadcastRoom() {
    this.#broadcast({ type: "room", room: this.room });
    this.changed();
  }

  #broadcast(message: HostMessage) {
    for (const { link, name } of this.#guests.values()) if (name) link.send(message);
  }

  /** Guests get the English and the key, to show it in their own language. */
  #notice(peerId: string, message: (t: Translate) => string) {
    if (peerId === HOST_ID) return this.toast(message(this.#t));
    let key: string | undefined;
    const text = message((k, fallback, vars) => ((key = k), english(k, fallback, vars)));
    this.#guests.get(peerId)?.link.send({ type: "notice", text, ...(key ? { key } : {}) } satisfies HostMessage);
  }
}

/** Whether `next` is what guests already extrapolate from `previous` (no need to resend). */
function samePlayback(previous: Playback | null, next: Playback | null, elapsed: number) {
  if (!previous || !next) return previous === next;
  if (previous.videoId !== next.videoId || previous.playing !== next.playing || previous.title !== next.title) return false;
  const expected = previous.position + (previous.playing ? elapsed : 0);
  return Math.abs(expected - next.position) < 1;
}

// ---------------------------------------------------------------- guest

export type GuestStatus = "connecting" | "connected" | "closed";

export class GuestSession extends Observable {
  readonly role = "guest";
  status: GuestStatus = "connecting";
  /** Our participant id. */
  you = "";
  hostName = "";
  room: RoomState | null = null;
  playback: Playback | null = null;
  /** Round-trip time to the host, smoothed. */
  rttMs = 0;
  closeReason = "";

  #link: Link;
  #player: PlayerPort;
  #receivedAt = 0;
  #ownChangeUntil = 0;
  #requestUntil = 0;
  #pendingLoad: { videoId: string; at: number } | null = null;
  #lastLocal: LocalPlayback | null = null;
  #cleanups: (() => void)[] = [];

  #t: Translate;

  constructor(options: { link: Link; player: PlayerPort; name: string; t?: Translate }) {
    super();
    this.#t = options.t ?? english;
    this.#link = options.link;
    this.#player = options.player;
    this.#link.onMessage((message) => {
      if (isHostMessage(message)) this.#handle(message);
    });
    this.#link.onClose(() => this.#end(this.closeReason || this.#t("plugins.music-together.toast.disconnected", "Music Together disconnected")));
    this.#send({ type: "hello", name: cleanName(options.name) });

    this.#cleanups.push(this.#player.subscribe(() => this.#onLocalChange()));
    const ping = setInterval(() => this.#send({ type: "ping", t: Date.now() }), PING_MS);
    const sync = setInterval(() => this.#sync(), 1000);
    this.#cleanups.push(() => clearInterval(ping), () => clearInterval(sync));
  }

  get permission(): Permission {
    return this.room?.permission ?? "host-only";
  }

  /** Whether we play what the host plays, within the drift tolerance. */
  get inSync() {
    const local = this.#player.snapshot();
    const playback = this.playback;
    if (!playback || !local) return !playback;
    return (
      local.videoId === playback.videoId &&
      local.playing === playback.playing &&
      Math.abs(local.position - this.#target(playback)) <= DRIFT_SECONDS
    );
  }

  suggest(videoId: string) {
    this.#send({ type: "suggest", videoId });
  }

  control(action: GuestAction) {
    this.#requestUntil = Date.now() + REQUEST_GRACE_MS;
    this.#send({ type: "control", action });
  }

  leave() {
    this.closeReason = this.#t("plugins.music-together.toast.left", "You left the session");
    this.#link.close();
    this.#end(this.closeReason);
  }

  #handle(message: HostMessage) {
    switch (message.type) {
      case "welcome":
        this.status = "connected";
        this.you = message.you;
        this.hostName = message.host;
        this.room = message.room;
        this.#setPlayback(message.playback);
        break;
      case "room": {
        const before = this.room?.permission;
        this.room = message.room;
        if (before && before !== message.room.permission) this.toast(permissionToast(message.room.permission, this.#t));
        break;
      }
      case "playback":
        this.#setPlayback(message.playback);
        break;
      case "pong": {
        const rtt = Date.now() - message.t;
        this.rttMs = this.rttMs ? this.rttMs * 0.7 + rtt * 0.3 : rtt;
        return;
      }
      case "notice":
        this.toast(message.key?.startsWith(NOTICE_PREFIX) ? this.#t(message.key, message.text) : message.text);
        return;
      case "closed":
        this.closeReason = this.#t("plugins.music-together.toast.host-ended", "The host ended the session");
        this.#link.close();
        return this.#end(this.closeReason);
    }
    this.changed();
  }

  #setPlayback(playback: Playback | null) {
    this.playback = playback;
    this.#receivedAt = Date.now();
    // A fresh host state supersedes whatever we asked for.
    this.#requestUntil = 0;
    this.#sync();
  }

  /** Where the host is now, extrapolated from its last message. */
  #target(playback: Playback) {
    if (!playback.playing) return playback.position;
    const elapsed = (Date.now() - this.#receivedAt + this.rttMs / 2) / 1000;
    return Math.min(playback.position + elapsed, playback.durationSeconds || Infinity);
  }

  #ours() {
    this.#ownChangeUntil = Date.now() + OWN_CHANGE_MS;
  }

  /** Makes the local player match the host. */
  #sync() {
    const playback = this.playback;
    if (this.status !== "connected" || !playback || Date.now() < this.#requestUntil) return;
    const local = this.#player.snapshot();
    if (local?.ad) return;
    const now = Date.now();

    if (local?.videoId !== playback.videoId) {
      const pending = this.#pendingLoad;
      if (pending?.videoId === playback.videoId && now - pending.at < LOAD_TIMEOUT_MS) return;
      this.#pendingLoad = { videoId: playback.videoId, at: now };
      this.#ours();
      this.#player.load(playback.videoId);
      return;
    }
    this.#pendingLoad = null;

    const target = this.#target(playback);
    if (Math.abs(local.position - target) > DRIFT_SECONDS) {
      this.#ours();
      this.#player.seek(target);
    }
    // Our copy ended a moment before the host's; it will move on with the host.
    if (local.playing !== playback.playing && !(local.ended && playback.playing)) {
      this.#ours();
      if (playback.playing) this.#player.play();
      else this.#player.pause();
    }
  }

  /** Local changes we didn't make are the user's: forward them (full control) or undo them. */
  #onLocalChange() {
    const local = this.#player.snapshot();
    const previous = this.#lastLocal;
    this.#lastLocal = local;
    const playback = this.playback;
    if (this.status !== "connected" || !local || !playback || local.ad || Date.now() < this.#ownChangeUntil) {
      return this.changed();
    }
    if (this.#pendingLoad && local.videoId !== this.#pendingLoad.videoId) return this.changed();

    if (this.permission === "control") {
      const target = this.#target(playback);
      // YTM autoplaying its own next track when ours ended is not a request.
      const autoplay = previous?.ended || (previous && previous.position >= previous.durationSeconds - 3);
      if (local.videoId !== playback.videoId && !autoplay) {
        this.control({ type: "load", videoId: local.videoId });
      } else if (local.videoId === playback.videoId && local.playing !== playback.playing && !local.ended) {
        this.control({ type: local.playing ? "play" : "pause" });
      } else if (local.videoId === playback.videoId && Math.abs(local.position - target) > DRIFT_SECONDS) {
        this.control({ type: "seek", seconds: local.position });
      }
    }
    this.#sync();
    this.changed();
  }

  #send(message: GuestMessage) {
    if (this.status !== "closed") this.#link.send(message);
  }

  #end(reason: string) {
    if (this.status === "closed") return;
    this.status = "closed";
    this.closeReason = reason;
    for (const cleanup of this.#cleanups) cleanup();
    this.toast(reason);
    this.changed();
  }
}

function permissionToast(permission: Permission, t: Translate) {
  switch (permission) {
    case "host-only":
      return t("plugins.music-together.toast.now-host-only", "The host now controls the music alone");
    case "suggest":
      return t("plugins.music-together.toast.now-suggest", "You can now suggest songs");
    case "control":
      return t("plugins.music-together.toast.now-control", "You can now control playback");
  }
}

export function cleanName(name: string) {
  return name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
}
