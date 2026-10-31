import { IDLE, type NowPlaying, type Track } from "@pear/sdk";
import { describe, expect, it } from "vitest";
import { type Play, ScrobbleTracker, scrobbleThreshold } from "../tracker.ts";

const track = (videoId: string, durationSeconds: number): Track => ({
  videoId,
  title: `Song ${videoId}`,
  artist: "Artist",
  durationSeconds,
  url: `https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/watch?v=${videoId}`,
  mediaType: "audio",
});

function setup() {
  const nowPlaying: Play[] = [];
  const scrobbles: Play[] = [];
  const tracker = new ScrobbleTracker({ nowPlaying: (p) => nowPlaying.push(p), scrobble: (p) => scrobbles.push(p) });
  let now = 1_000_000;
  let state: NowPlaying = { ...IDLE };
  const set = (patch: Partial<NowPlaying>) => {
    state = { ...state, ...patch, updatedAt: now };
    tracker.update(state, now);
  };
  /** Advances time, sending position updates every second like the page does. */
  const advance = (seconds: number) => {
    for (let i = 0; i < seconds; i++) {
      now += 1000;
      const playing = state.status === "playing" && !state.ad;
      set(playing ? { positionSeconds: state.positionSeconds + 1 } : {});
    }
  };
  return { tracker, nowPlaying, scrobbles, set, advance, now: () => now };
}

describe("scrobbleThreshold", () => {
  it("is half the duration, capped at 4 minutes", () => {
    expect(scrobbleThreshold(200)).toBe(100);
    expect(scrobbleThreshold(600)).toBe(240);
  });
  it("never scrobbles tracks of 30 seconds or less", () => {
    expect(scrobbleThreshold(30)).toBeNull();
    expect(scrobbleThreshold(12)).toBeNull();
  });
  it("uses 4 minutes when the duration is unknown", () => {
    expect(scrobbleThreshold(0)).toBe(240);
  });
});

describe("ScrobbleTracker", () => {
  it("sends now playing on start and scrobbles at half the duration", () => {
    const t = setup();
    t.set({ track: track("a", 200), status: "playing", positionSeconds: 0 });
    expect(t.nowPlaying).toHaveLength(1);
    const startedAt = t.now();
    t.advance(99);
    expect(t.scrobbles).toHaveLength(0);
    t.advance(1);
    expect(t.scrobbles).toEqual([{ track: track("a", 200), startedAt }]);
    t.advance(100);
    expect(t.scrobbles).toHaveLength(1);
  });

  it("scrobbles after 4 minutes for long tracks", () => {
    const t = setup();
    t.set({ track: track("long", 3600), status: "playing" });
    t.advance(239);
    expect(t.scrobbles).toHaveLength(0);
    t.advance(1);
    expect(t.scrobbles).toHaveLength(1);
  });

  it("does not count paused time, and re-sends now playing on resume", () => {
    const t = setup();
    t.set({ track: track("a", 200), status: "playing" });
    t.advance(60);
    t.set({ status: "paused" });
    t.advance(300);
    expect(t.scrobbles).toHaveLength(0);
    expect(t.tracker.listened(t.now())).toBe(60);
    t.set({ status: "playing" });
    expect(t.nowPlaying).toHaveLength(2);
    t.advance(40);
    expect(t.scrobbles).toHaveLength(1);
  });

  it("does not count ads", () => {
    const t = setup();
    t.set({ track: track("a", 200), status: "playing", ad: true });
    t.advance(120);
    expect(t.nowPlaying).toHaveLength(0);
    expect(t.scrobbles).toHaveLength(0);
    t.set({ ad: false });
    expect(t.nowPlaying).toHaveLength(1);
    t.advance(100);
    expect(t.scrobbles).toHaveLength(1);
  });

  it("does not count seeking forward as listening", () => {
    const t = setup();
    t.set({ track: track("a", 200), status: "playing" });
    t.advance(10);
    t.set({ positionSeconds: 150 });
    t.advance(10);
    expect(t.scrobbles).toHaveLength(0);
  });

  it("never scrobbles short tracks but still reports them as playing", () => {
    const t = setup();
    t.set({ track: track("jingle", 25), status: "playing" });
    t.advance(25);
    expect(t.nowPlaying).toHaveLength(1);
    expect(t.scrobbles).toHaveLength(0);
    expect(t.tracker.timeUntilScrobble(t.now())).toBeNull();
  });

  it("starts over when the track changes, without carrying listening time", () => {
    const t = setup();
    t.set({ track: track("a", 200), status: "playing" });
    t.advance(90);
    t.set({ track: track("b", 200), positionSeconds: 0 });
    expect(t.nowPlaying.map((p) => p.track.videoId)).toEqual(["a", "b"]);
    t.advance(20);
    expect(t.scrobbles).toHaveLength(0);
    t.advance(80);
    expect(t.scrobbles.map((p) => p.track.videoId)).toEqual(["b"]);
  });

  it("counts a replay of the same track (repeat one) as a new play", () => {
    const t = setup();
    t.set({ track: track("a", 200), status: "playing" });
    t.advance(198);
    expect(t.scrobbles).toHaveLength(1);
    t.set({ positionSeconds: 0 });
    t.advance(100);
    expect(t.scrobbles).toHaveLength(2);
    expect(t.nowPlaying).toHaveLength(2);
  });

  it("counts playing again after the end as a new play", () => {
    const t = setup();
    t.set({ track: track("a", 200), status: "playing" });
    t.advance(120);
    t.set({ status: "ended" });
    t.set({ status: "playing", positionSeconds: 0 });
    t.advance(100);
    expect(t.scrobbles).toHaveLength(2);
  });

  it("reports the time left until the threshold for timers", () => {
    const t = setup();
    t.set({ track: track("a", 200), status: "playing" });
    t.advance(30);
    expect(t.tracker.timeUntilScrobble(t.now())).toBe(70_000);
    expect(t.tracker.timeUntilScrobble(t.now() + 5_000)).toBe(65_000);
    t.set({ status: "paused" });
    expect(t.tracker.timeUntilScrobble(t.now())).toBeNull();
  });

  it("forgets the play when the player goes idle", () => {
    const t = setup();
    t.set({ track: track("a", 200), status: "playing" });
    t.advance(50);
    t.set({ track: null, status: "idle" });
    expect(t.tracker.listened(t.now())).toBe(0);
  });
});
