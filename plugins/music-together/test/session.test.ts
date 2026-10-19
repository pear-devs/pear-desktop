import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { formatCode, normalizeCode, parseVideoId, randomCode } from "../protocol.ts";
import { GuestSession, HostSession, type Link, type LocalPlayback, type PlayerPort } from "../session.ts";

/** A player whose position advances with (fake) time. */
class FakePlayer implements PlayerPort {
  videoId = "";
  playing = false;
  ad = false;
  ended = false;
  duration = 200;
  #base = 0;
  #since = Date.now();
  #listeners = new Set<() => void>();
  calls: string[] = [];

  get position() {
    return this.#base + (this.playing ? (Date.now() - this.#since) / 1000 : 0);
  }

  snapshot(): LocalPlayback | null {
    if (!this.videoId) return null;
    return {
      videoId: this.videoId,
      title: `Title ${this.videoId}`,
      artist: "Artist",
      durationSeconds: this.duration,
      playing: this.playing,
      position: this.position,
      ad: this.ad,
      ended: this.ended,
    };
  }

  #set(patch: { videoId?: string; playing?: boolean; position?: number; ended?: boolean }) {
    const { position = this.position, ...rest } = patch;
    Object.assign(this, { ended: false }, rest);
    this.#base = position;
    this.#since = Date.now();
    for (const listener of this.#listeners) listener();
  }

  load(videoId: string) {
    this.calls.push(`load ${videoId}`);
    this.#set({ videoId, position: 0, playing: true });
  }
  play() {
    this.calls.push("play");
    this.#set({ playing: true });
  }
  pause() {
    this.calls.push("pause");
    this.#set({ playing: false });
  }
  seek(seconds: number) {
    this.calls.push(`seek ${Math.round(seconds)}`);
    this.#set({ position: seconds });
  }
  next() {
    this.calls.push("next");
    this.#set({ videoId: "autoplay-next", position: 0 });
  }
  /** The user (or YTM itself) did something. */
  user(patch: { videoId?: string; playing?: boolean; position?: number; ended?: boolean }) {
    this.#set(patch);
  }
  subscribe(listener: () => void) {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  }
}

/** Two connected in-memory link ends; messages are cloned and delivered asynchronously, like a data channel. */
function linkPair(guestId: string): [host: Link, guest: Link] {
  const make = (peerId: string) => {
    const messages = new Set<(m: unknown) => void>();
    const closes = new Set<() => void>();
    return { peerId, messages, closes, open: true };
  };
  const a = make(guestId);
  const b = make("host-peer");
  const end = (self: ReturnType<typeof make>, other: ReturnType<typeof make>): Link => ({
    peerId: self.peerId,
    send(message) {
      if (!self.open) return;
      const copy = structuredClone(message);
      queueMicrotask(() => other.messages.forEach((l) => l(copy)));
    },
    onMessage: (listener) => void self.messages.add(listener),
    onClose: (listener) => void self.closes.add(listener),
    close() {
      for (const side of [self, other]) {
        if (!side.open) continue;
        side.open = false;
        queueMicrotask(() => side.closes.forEach((l) => l()));
      }
    },
  });
  return [end(a, b), end(b, a)];
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

function setup(permission: "host-only" | "suggest" | "control" = "suggest") {
  const hostPlayer = new FakePlayer();
  hostPlayer.load("song-a");
  hostPlayer.calls = [];
  const host = new HostSession({
    player: hostPlayer,
    name: "Hosty",
    permission,
    resolve: async (videoId) => ({ title: `Resolved ${videoId}`, artist: "Someone" }),
  });
  const join = (id: string, name: string) => {
    const player = new FakePlayer();
    const [hostEnd, guestEnd] = linkPair(id);
    host.addLink(hostEnd);
    const guest = new GuestSession({ link: guestEnd, player, name });
    return { guest, player };
  };
  return { host, hostPlayer, join };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "setTimeout", "Date"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("protocol helpers", () => {
  test("room codes", () => {
    const code = randomCode();
    expect(normalizeCode(code)).toBe(code);
    expect(normalizeCode(` ${formatCode(code).toLowerCase()} `)).toBe(code);
    expect(normalizeCode("ABC")).toBeUndefined();
    expect(normalizeCode("ABCDE0")).toBeUndefined();
  });
  test("video ids from links", () => {
    expect(parseVideoId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(parseVideoId("https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/watch?v=dQw4w9WgXcQ&list=RD")).toBe("dQw4w9WgXcQ");
    expect(parseVideoId("https://youtu.be/dQw4w9WgXcQ?si=x")).toBe("dQw4w9WgXcQ");
    expect(parseVideoId("https://example.com/watch?v=dQw4w9WgXcQ")).toBeUndefined();
    expect(parseVideoId("hello")).toBeUndefined();
  });
});

describe("music together", () => {
  test("a guest joins, gets the room and mirrors the host's track and position", async () => {
    const { host, hostPlayer, join } = setup();
    const toasts: string[] = [];
    host.onToast((t) => toasts.push(t));
    vi.advanceTimersByTime(30_000);

    const { guest, player } = join("peer-1", "  Alice  ");
    await flush();
    expect(guest.status).toBe("connected");
    expect(guest.hostName).toBe("Hosty");
    expect(host.participants.map((p) => p.name)).toEqual(["Hosty", "Alice"]);
    expect(guest.room?.participants.map((p) => p.name)).toEqual(["Hosty", "Alice"]);
    expect(toasts).toEqual(["Alice joined"]);

    expect(player.videoId).toBe("song-a");
    // Loading starts at 0; the next sync seeks to the host's position.
    vi.advanceTimersByTime(1000);
    await flush();
    expect(Math.abs(player.position - hostPlayer.position)).toBeLessThanOrEqual(2);
    expect(guest.inSync).toBe(true);
  });

  test("host play/pause, seeks and track changes reach guests", async () => {
    const { hostPlayer, join } = setup();
    const { guest, player } = join("peer-1", "Alice");
    await flush();

    hostPlayer.pause();
    await flush();
    expect(player.playing).toBe(false);

    hostPlayer.seek(120);
    await flush();
    expect(Math.round(player.position)).toBe(120);

    hostPlayer.play();
    hostPlayer.load("song-b");
    await flush();
    expect(player.videoId).toBe("song-b");
    expect(player.playing).toBe(true);
    expect(guest.playback?.videoId).toBe("song-b");
  });

  test("guests correct drift beyond the tolerance only", async () => {
    const { hostPlayer, join } = setup();
    const { player } = join("peer-1", "Alice");
    await flush();
    vi.advanceTimersByTime(2000);
    await flush();
    player.calls = [];

    // Small drift is tolerated.
    player.user({ position: hostPlayer.position + 1 });
    vi.advanceTimersByTime(2000);
    await flush();
    expect(player.calls).toEqual([]);

    // Large drift (e.g. a stall) is corrected by the next sync.
    vi.advanceTimersByTime(2000);
    player.user({ position: hostPlayer.position - 10 });
    vi.advanceTimersByTime(2000);
    await flush();
    expect(player.calls.some((c) => c.startsWith("seek"))).toBe(true);
    expect(Math.abs(player.position - hostPlayer.position)).toBeLessThanOrEqual(2);
  });

  test("without control, a guest's own pause is undone", async () => {
    const { hostPlayer, join } = setup("suggest");
    const { player } = join("peer-1", "Alice");
    await flush();
    vi.advanceTimersByTime(2000);
    await flush();

    player.user({ playing: false });
    await flush();
    expect(player.playing).toBe(true);
    expect(hostPlayer.playing).toBe(true);
  });

  test("with full control, a guest's pause, seek and track change apply to everyone", async () => {
    const { hostPlayer, join } = setup("control");
    const alice = join("peer-1", "Alice");
    const bob = join("peer-2", "Bob");
    await flush();
    vi.advanceTimersByTime(2000);
    await flush();

    alice.player.user({ playing: false });
    await flush();
    expect(hostPlayer.playing).toBe(false);
    expect(bob.player.playing).toBe(false);

    vi.advanceTimersByTime(2000);
    alice.player.user({ position: 90 });
    await flush();
    expect(Math.round(hostPlayer.position)).toBe(90);
    expect(Math.round(bob.player.position)).toBe(90);

    vi.advanceTimersByTime(2000);
    alice.player.user({ videoId: "song-c", position: 0, playing: true });
    await flush();
    expect(hostPlayer.videoId).toBe("song-c");
    expect(bob.player.videoId).toBe("song-c");
  });

  test("guests wait while the host watches an ad", async () => {
    const { hostPlayer, join } = setup();
    const { player } = join("peer-1", "Alice");
    await flush();
    hostPlayer.ad = true;
    hostPlayer.user({});
    await flush();
    expect(player.playing).toBe(false);
  });

  test("suggestions are resolved, queued and played before YTM's autoplay", async () => {
    const { host, hostPlayer, join } = setup("suggest");
    const { guest } = join("peer-1", "Alice");
    await flush();

    guest.suggest("song-q");
    await flush();
    expect(host.queue).toEqual([{ id: "1", videoId: "song-q", title: "Resolved song-q", artist: "Someone", by: "peer-1" }]);
    expect(guest.room?.queue.map((i) => i.videoId)).toEqual(["song-q"]);

    // Duplicates are refused with a notice to the sender.
    const notices: string[] = [];
    guest.onToast((t) => notices.push(t));
    guest.suggest("song-q");
    await flush();
    expect(notices).toEqual(["That song is already in the queue"]);

    hostPlayer.user({ playing: false, ended: true });
    await flush();
    expect(hostPlayer.videoId).toBe("song-q");
    expect(host.queue).toEqual([]);
  });

  test("permissions gate suggestions and controls; guests may remove their own items", async () => {
    const { host, hostPlayer, join } = setup("host-only");
    const { guest } = join("peer-1", "Alice");
    await flush();
    const notices: string[] = [];
    guest.onToast((t) => notices.push(t));

    guest.suggest("song-q");
    guest.control({ type: "next" });
    await flush();
    expect(host.queue).toEqual([]);
    expect(hostPlayer.calls).toEqual([]);
    expect(notices).toEqual(["The host isn't taking suggestions", "Only the host controls playback"]);

    host.setPermission("suggest");
    await flush();
    expect(notices.at(-1)).toBe("You can now suggest songs");
    guest.suggest("song-q");
    await flush();
    guest.control({ type: "removeItem", id: host.queue[0]!.id });
    await flush();
    expect(host.queue).toEqual([]);
  });

  test("leaving and closing", async () => {
    const { host, join } = setup();
    const toasts: string[] = [];
    host.onToast((t) => toasts.push(t));
    const alice = join("peer-1", "Alice");
    const bob = join("peer-2", "Bob");
    await flush();

    alice.guest.leave();
    await flush();
    expect(alice.guest.status).toBe("closed");
    expect(host.participants.map((p) => p.name)).toEqual(["Hosty", "Bob"]);
    expect(toasts).toContain("Alice left");
    expect(bob.guest.room?.participants.map((p) => p.name)).toEqual(["Hosty", "Bob"]);

    host.close();
    await flush();
    expect(bob.guest.status).toBe("closed");
    expect(bob.guest.closeReason).toBe("The host ended the session");
  });
});
