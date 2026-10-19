import { IDLE, type NowPlaying } from "@pear/sdk";
import { describe, expect, it } from "vitest";
import { type ActivityOptions, buildActivity, needsUpdate, sanitize } from "../activity.ts";

const options: ActivityOptions = {
  activityType: "listening",
  statusDisplayType: "details",
  playButton: true,
  hideGitHubButton: false,
  hideDurationLeft: false,
  hideWhenPaused: false,
};
const now = 1_700_000_000_000;
const playing: NowPlaying = {
  ...IDLE,
  track: {
    videoId: "abc",
    title: "Song",
    artist: "Artist",
    album: "Album",
    artworkUrl: "https://img.test/a.jpg",
    durationSeconds: 200,
    url: "https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/watch?v=abc",
    mediaType: "audio",
  },
  status: "playing",
  positionSeconds: 50,
  updatedAt: now,
};

describe("sanitize", () => {
  it("pads short and truncates long text", () => {
    expect(sanitize("a")).toBe("aㅤ");
    expect(sanitize("x".repeat(200))).toHaveLength(128);
    expect(sanitize("  ")).toBe("Unknown");
  });
});

describe("buildActivity", () => {
  it("shows the track with timestamps and buttons", () => {
    expect(buildActivity(playing, undefined, options, now)).toEqual({
      type: 2,
      statusDisplayType: 2,
      details: "Song",
      detailsUrl: "https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/watch?v=abc",
      state: "Artist",
      instance: false,
      largeImageKey: "https://img.test/a.jpg",
      largeImageText: "Album",
      buttons: [
        { label: "Play on \u0059\u006f\u0075\u0054\u0075\u0062\u0065 Music", url: "https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/watch?v=abc" },
        { label: "View App On GitHub", url: "https://github.com/pear-devs/pear-desktop" },
      ],
      startTimestamp: Math.floor((now - 50_000) / 1000),
      endTimestamp: Math.floor((now + 150_000) / 1000),
    });
  });

  it("prefers the alternative title and canonical artist for the same track", () => {
    const details = { videoId: "abc", alternativeTitle: "Alt", tags: ["Canonical"], artistUrl: "https://a.test" };
    expect(buildActivity(playing, details, options, now)).toMatchObject({ details: "Alt", state: "Canonical", stateUrl: "https://a.test" });
    expect(buildActivity(playing, { ...details, videoId: "other" }, options, now)).toMatchObject({ details: "Song" });
  });

  it("marks pauses and ads without timestamps, or hides them", () => {
    for (const state of [{ ...playing, status: "paused" as const }, { ...playing, ad: true }]) {
      const activity = buildActivity(state, undefined, options, now)!;
      expect(activity.largeImageText).toBe("⏸︎");
      expect(activity.startTimestamp).toBeUndefined();
      expect(buildActivity(state, undefined, { ...options, hideWhenPaused: true }, now)).toBeNull();
    }
  });

  it("respects the display options", () => {
    const activity = buildActivity(
      playing,
      undefined,
      { ...options, activityType: "playing", statusDisplayType: "state", playButton: false, hideGitHubButton: true, hideDurationLeft: true },
      now,
    )!;
    expect(activity).toMatchObject({ type: 0, statusDisplayType: 1 });
    expect(activity.buttons).toBeUndefined();
    expect(activity.endTimestamp).toBeUndefined();
  });

  it("clears without a track", () => {
    expect(buildActivity(IDLE, undefined, options, now)).toBeNull();
  });
});

describe("needsUpdate", () => {
  const a = buildActivity(playing, undefined, options, now);
  it("ignores small timestamp drift but not seeks or changes", () => {
    expect(needsUpdate(a, buildActivity({ ...playing, positionSeconds: 51 }, undefined, options, now + 1000))).toBe(false);
    expect(needsUpdate(a, buildActivity({ ...playing, positionSeconds: 120 }, undefined, options, now))).toBe(true);
    expect(needsUpdate(a, buildActivity({ ...playing, status: "paused" }, undefined, options, now))).toBe(true);
    expect(needsUpdate(a, null)).toBe(true);
    expect(needsUpdate(null, null)).toBe(false);
  });
});
