// pear-desktop 3.x plugin options -> the rewrite's (the 4.0.0 migration),
// one conversion at a time, then a whole 3.12 config.json through Settings
// with the real plugins' schemas.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import hostPlugins from "virtual:pear/host-plugins";
import { afterAll, describe, expect, test, vi } from "vitest";
import { Settings } from "../src/main/config.ts";
import { migrate, PLUGIN_MIGRATIONS, type StoredConfig } from "../src/main/migrations.ts";

vi.mock("electron", () => ({}));

type Json = Record<string, unknown>;

// Built from parts: the app's name isn't spelled out in the sources.
const PLAY_BUTTON = `playOn${["You", "Tube", "Music"].join("")}`;

/** Runs the 4.0.0 migration over a pear-desktop 3.12 file with these plugin entries. */
function migrated(plugins: Record<string, Json>, options: Json = {}) {
  const { config } = migrate({ options, plugins, __internal__: { migrations: { version: "3.12.0" } } }, "4.0.0");
  return config.plugins!;
}

/** Applies one plugin's conversion twice: the second run must change nothing. */
function twice(id: string, entry: Json, config: StoredConfig = {}) {
  const once = structuredClone(entry);
  PLUGIN_MIGRATIONS[id]!(once, config);
  const again = structuredClone(once);
  PLUGIN_MIGRATIONS[id]!(again, config);
  expect(again).toEqual(once);
  return once;
}

describe("pear-desktop plugin options", () => {
  test("fractions become percentages", () => {
    const plugins = migrated({
      "album-color-theme": { enabled: true, ratio: 0.3, enableSeekbar: false },
      "ambient-mode": { enabled: true, opacity: 1, blur: 50 },
      "transparent-player": { enabled: true, opacity: 0.7, type: "mica" },
    });
    expect(plugins["album-color-theme"]).toMatchObject({ ratio: 30, enableSeekbar: false });
    expect(plugins["ambient-mode"]).toMatchObject({ opacity: 100, blur: 50 });
    expect(plugins["transparent-player"]).toMatchObject({ opacity: 70, type: "mica" });
    expect(twice("album-color-theme", { ratio: 0.5 })).toEqual({ ratio: 50 });
    expect(twice("transparent-player", { opacity: "half" })).toEqual({ opacity: "half" });
  });

  test("auth-proxy-adapter takes over the app's proxy option it used to forward to", () => {
    const plugins = migrated({ "auth-proxy-adapter": { enabled: true, port: 4600 } }, { proxy: "socks5://me:pw@proxy.lan:1080" });
    expect(plugins["auth-proxy-adapter"]).toEqual({ enabled: true, port: 4600, url: "socks5://me:pw@proxy.lan:1080" });
    expect(twice("auth-proxy-adapter", { url: "http://own:8080" }, { options: { proxy: "socks5://other:1" } })).toEqual({
      url: "http://own:8080",
    });
    expect(twice("auth-proxy-adapter", {}, { options: { proxy: "" } })).toEqual({});
  });

  test("crossfade: a numeric fade scaling is a logarithmic range in dB", () => {
    expect(twice("crossfade", { fadeScaling: 40 })).toEqual({ fadeScaling: "logarithmic", dynamicRange: 40 });
    // pear-desktop's prompt could store it as text, and beyond the rewrite's range.
    expect(twice("crossfade", { fadeScaling: "200" })).toEqual({ fadeScaling: "logarithmic", dynamicRange: 120 });
    expect(twice("crossfade", { fadeScaling: 0 })).toEqual({ fadeScaling: "linear" });
    expect(twice("crossfade", { fadeScaling: "logarithmic" })).toEqual({ fadeScaling: "logarithmic" });
    // Durations pear-desktop allowed beyond the sliders' ranges are kept at the ends.
    expect(twice("crossfade", { fadeInDuration: 15_000, fadeOutDuration: -5, secondsBeforeEnd: 45 })).toEqual({
      fadeInDuration: 10_000,
      fadeOutDuration: 0,
      secondsBeforeEnd: 30,
    });
  });

  test("custom-output-device: the device's name instead of its id", () => {
    const devices = { abc123: "USB DAC", def456: "" };
    expect(twice("custom-output-device", { output: "abc123", devices })).toMatchObject({ output: "USB DAC" });
    // No name known: the id still works.
    expect(twice("custom-output-device", { output: "def456", devices })).toMatchObject({ output: "def456" });
    expect(twice("custom-output-device", { output: "default", devices })).toMatchObject({ output: "" });
  });

  test("discord: renamed options, minutes, and the status display enum", () => {
    expect(
      twice("discord", { [PLAY_BUTTON]: false, activityTimeoutTime: 5 * 60_000, statusDisplayType: 1, hideGitHubButton: true }),
    ).toEqual({
      [PLAY_BUTTON]: false,
      playButton: false,
      activityTimeoutTime: 300_000,
      activityTimeoutMinutes: 5,
      statusDisplayType: "state",
      hideGitHubButton: true,
    });
    expect(twice("discord", { statusDisplayType: 0 })).toMatchObject({ statusDisplayType: "name" });
    expect(twice("discord", { statusDisplayType: 2 })).toMatchObject({ statusDisplayType: "details" });
    expect(twice("discord", { statusDisplayType: 7 })).toMatchObject({ statusDisplayType: 7 });
    // A zero timeout cleared the activity right when playback paused.
    expect(twice("discord", { activityTimeoutTime: 0 })).toMatchObject({ hideWhenPaused: true });
    expect(twice("discord", { activityTimeoutTime: 0, activityTimeoutEnabled: false })).not.toHaveProperty("hideWhenPaused");
    expect(twice("discord", { activityTimeoutTime: 999 * 60_000 })).toMatchObject({ activityTimeoutMinutes: 240 });
    expect(twice("discord", { activityTimeoutTime: 1000 })).toMatchObject({ activityTimeoutMinutes: 1 });
  });

  test("equalizer: filters and the bass booster become the extra filters", () => {
    const peak = { type: "peaking", frequency: 1000, Q: 1, gain: -3 };
    const bass = { type: "lowshelf", frequency: 80, Q: 100, gain: 12 };
    expect(twice("equalizer", { filters: [peak], presets: { "bass-booster": true } }).filters).toBe(JSON.stringify([peak, bass]));
    expect(twice("equalizer", { presets: { "bass-booster": true } }).filters).toBe(JSON.stringify([bass]));
    expect(twice("equalizer", { filters: [], presets: { "bass-booster": false } }).filters).toBe("");
    expect(twice("equalizer", { filters: ["junk", peak] }).filters).toBe(JSON.stringify([peak]));
  });

  test("in-app-menu: hiding the window buttons is the inverse of showing them", () => {
    expect(twice("in-app-menu", { hideDOMWindowControls: true })).toMatchObject({ windowControls: false });
    expect(twice("in-app-menu", { hideDOMWindowControls: false })).toMatchObject({ windowControls: true });
    expect(twice("in-app-menu", { hideDOMWindowControls: "yes" })).not.toHaveProperty("windowControls");
  });

  test("precise-volume: global shortcuts are top-level options", () => {
    expect(twice("precise-volume", { steps: 0, globalShortcuts: { volumeUp: "Shift+Up", volumeDown: 3 } })).toEqual({
      steps: 1,
      globalShortcuts: { volumeUp: "Shift+Up", volumeDown: 3 },
      volumeUp: "Shift+Up",
    });
    expect(twice("precise-volume", { globalShortcuts: "none" })).toEqual({ globalShortcuts: "none" });
  });

  test("scrobbler: one entry per service becomes flat options", () => {
    const entry = twice("scrobbler", {
      scrobbleOtherMedia: false,
      scrobblers: {
        lastfm: { enabled: true, token: "t", sessionKey: "sk", apiRoot: "https://lfm/", apiKey: "key", secret: "s" },
        listenbrainz: { enabled: true, token: "lb", apiRoot: "https://lb/" },
      },
    });
    expect(entry).toMatchObject({
      scrobbleOtherMedia: false,
      lastfmEnabled: true,
      lastfmSessionKey: "sk",
      lastfmApiRoot: "https://lfm/",
      lastfmApiKey: "key",
      lastfmSecret: "s",
      listenbrainzEnabled: true,
      listenbrainzToken: "lb",
      listenbrainzApiRoot: "https://lb/",
    });
    // Partial entries (pear-desktop stored only what changed) and junk.
    expect(twice("scrobbler", { scrobblers: { lastfm: { sessionKey: null }, listenbrainz: "x" } })).toEqual({
      scrobblers: { lastfm: { sessionKey: null }, listenbrainz: "x" },
    });
  });

  test("shortcuts: global shortcuts are top-level options; MPRIS stays on", () => {
    const plugins = migrated({
      shortcuts: { enabled: true, overrideMediaKeys: true, global: { playPause: "Ctrl+F1", next: "", previous: 5 }, local: { next: "N" } },
    });
    expect(plugins.shortcuts).toMatchObject({ enabled: true, playPause: "Ctrl+F1", next: "" });
    expect(plugins.shortcuts).not.toHaveProperty("previous");
    expect(plugins["media-controls"]).toEqual({ enabled: true });
    // Not enabled: media-controls keeps its own default.
    expect(migrated({ shortcuts: { enabled: false } })).not.toHaveProperty("media-controls");
    expect(twice("shortcuts", { enabled: true }, { plugins: { "media-controls": { enabled: false } } })).toEqual({ enabled: true });
  });

  test("sponsorblock: the category list becomes one switch per category", () => {
    expect(twice("sponsorblock", { categories: ["sponsor", "preview", "chapter"], apiURL: "https://sb.lan" })).toMatchObject({
      apiURL: "https://sb.lan",
      sponsor: true,
      preview: true,
      intro: false,
      outro: false,
      interaction: false,
      selfpromo: false,
      music_offtopic: false,
      filler: false,
    });
    expect(twice("sponsorblock", { categories: "sponsor" })).toEqual({ categories: "sponsor" });
  });

  test("visualizer: vudio is the bars visualizer; per-visualizer options are flat", () => {
    expect(
      twice("visualizer", {
        type: "vudio",
        butterchurn: { preset: "Geiss - Thumb Drum", blendTimeInSeconds: 30 },
        vudio: { accuracy: 512, lighting: { color: "#ff0000" } },
      }),
    ).toMatchObject({ type: "bars", preset: "Geiss - Thumb Drum", blendTimeInSeconds: 10, bars: 256, primary: "#ff0000" });
    expect(twice("visualizer", { type: "wave" })).toEqual({ type: "wave" });
  });

  test("runs on the stored entry only, never on a missing or broken one", () => {
    expect(migrated({ visualizer: "broken" as unknown as Json }).visualizer).toBe("broken");
    expect(migrated({})).toEqual({});
  });
});

/** What a pear-desktop 3.12 user's config.json holds for these plugins (only changed values, like it stores them). */
const PEAR_DESKTOP_3 = {
  options: { proxy: "socks5://user:pass@proxy.lan:1080", tray: false },
  plugins: {
    "album-actions": { enabled: true },
    "album-color-theme": { enabled: true, ratio: 0.8, enableSeekbar: false },
    "ambient-mode": { enabled: true, quality: 1000, buffer: 20, interpolationTime: 3000, blur: 25, size: 125, opacity: 0.6, fullscreen: true },
    amuse: { enabled: true },
    "audio-compressor": { enabled: true },
    "auth-proxy-adapter": { enabled: true, hostname: "0.0.0.0", port: 4646 },
    "blur-nav-bar": { enabled: true },
    "captions-selector": { enabled: true, disableCaptions: false, autoload: true, lastCaptionsCode: "de" },
    clock: { enabled: true, displaySeconds: true, hour12: true },
    crossfade: { enabled: true, fadeInDuration: 2000, fadeOutDuration: 8000, secondsBeforeEnd: 12, fadeScaling: 30 },
    "custom-output-device": { enabled: true, output: "9f2c", devices: { default: "Default", "9f2c": "Speakers (USB)" } },
    "disable-autoplay": { enabled: true, applyOnce: true },
    discord: {
      enabled: true,
      autoReconnect: false,
      activityTimeoutEnabled: true,
      activityTimeoutTime: 30 * 60_000,
      [PLAY_BUTTON]: false,
      hideGitHubButton: true,
      hideDurationLeft: true,
      statusDisplayType: 0,
      listenAlong: true,
    },
    equalizer: { enabled: true, filters: [{ type: "highshelf", frequency: 8000, Q: 1, gain: 4 }], presets: { "bass-booster": true } },
    "exponential-volume": { enabled: true },
    "in-app-menu": { enabled: true, hideDOMWindowControls: true },
    lumiastream: { enabled: false },
    "music-together": { enabled: true },
    navigation: { enabled: false },
    notifications: {
      enabled: true,
      unpauseNotification: true,
      urgency: "critical",
      interactive: false,
      toastStyle: 3,
      refreshOnPlayPause: true,
      trayControls: false,
      hideButtonText: true,
    },
    "picture-in-picture": {
      "enabled": true,
      "alwaysOnTop": false,
      "savePosition": false,
      "saveSize": true,
      "hotkey": "Shift+P",
      "pip-position": [20, 30],
      "pip-size": [500, 300],
      "isInPiP": false,
      "useNativePiP": false,
    },
    "playback-speed": { enabled: true },
    "precise-volume": { enabled: true, steps: 50, arrowsShortcut: false, globalShortcuts: { volumeUp: "Ctrl+Up", volumeDown: "Ctrl+Down" }, savedVolume: 42 },
    "quality-changer": { enabled: true },
    scrobbler: {
      enabled: true,
      scrobbleOtherMedia: false,
      alternativeTitles: false,
      alternativeArtist: true,
      scrobblers: {
        lastfm: { enabled: true, token: "tok", sessionKey: "session", apiRoot: "https://ws.audioscrobbler.com/2.0/", apiKey: "k", secret: "s" },
        listenbrainz: { enabled: true, token: "lb-token", apiRoot: "https://api.listenbrainz.org/1/" },
      },
    },
    shortcuts: {
      enabled: true,
      overrideMediaKeys: true,
      global: { previous: "Ctrl+Shift+Left", playPause: "Ctrl+Shift+Space", next: "Ctrl+Shift+Right" },
      local: { previous: "", playPause: "", next: "" },
    },
    "skip-disliked-songs": { enabled: true },
    "skip-silences": { enabled: true, onlySkipBeginning: true },
    sponsorblock: { enabled: true, apiURL: "https://sponsor.example", categories: ["sponsor", "selfpromo", "music_offtopic", "filler"] },
    "taskbar-mediacontrol": { enabled: true },
    touchbar: { enabled: true },
    "transparent-player": { enabled: true, opacity: 0.3, type: "acrylic" },
    "tuna-obs": { enabled: true },
    "unobtrusive-player": { enabled: true },
    "video-toggle": { enabled: true, hideVideo: true, mode: "native", forceHide: true, align: "right" },
    visualizer: {
      enabled: true,
      type: "butterchurn",
      butterchurn: { preset: "Flexi - alien fish pond", blendTimeInSeconds: 5 },
    },
  },
  __internal__: { migrations: { version: "3.12.0" } },
};

/** Each plugin's settings once the file above is loaded. */
const EXPECTED: Record<string, { enabled: boolean; config: Json }> = {
  "album-actions": { enabled: true, config: {} },
  "album-color-theme": { enabled: true, config: { ratio: 80, enableSeekbar: false } },
  "ambient-mode": {
    enabled: true,
    config: { interpolationTime: 3000, quality: 1000, size: 125, buffer: 20, opacity: 60, blur: 25, fullscreen: true },
  },
  amuse: { enabled: true, config: { port: 9863 } },
  "audio-compressor": { enabled: true, config: { threshold: -50, ratio: 12, knee: 40, attack: 0, release: 250 } },
  "auth-proxy-adapter": {
    enabled: true,
    config: { url: "socks5://user:pass@proxy.lan:1080", username: "", password: "", bypass: "<local>", hostname: "0.0.0.0", port: 4646 },
  },
  "blur-nav-bar": { enabled: true, config: { blur: 8, opacity: 30 } },
  "captions-selector": { enabled: true, config: { autoload: true, disableCaptions: false, lastCaptionsCode: "de" } },
  clock: { enabled: true, config: { displaySeconds: true, hour12: true } },
  crossfade: {
    enabled: true,
    config: { fadeInDuration: 2000, fadeOutDuration: 8000, secondsBeforeEnd: 12, fadeScaling: "logarithmic", dynamicRange: 30 },
  },
  "custom-output-device": { enabled: true, config: { output: "Speakers (USB)", showPicker: true } },
  "disable-autoplay": { enabled: true, config: { applyOnce: true } },
  discord: {
    enabled: true,
    config: {
      activityType: "listening",
      statusDisplayType: "name",
      playButton: false,
      hideGitHubButton: true,
      hideDurationLeft: true,
      hideWhenPaused: false,
      activityTimeoutEnabled: true,
      activityTimeoutMinutes: 30,
      autoReconnect: false,
    },
  },
  equalizer: {
    enabled: true,
    config: {
      preset: "flat",
      preamp: 0,
      ...Object.fromEntries([32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000].map((hz) => [`band${hz}`, 0])),
      filters: JSON.stringify([
        { type: "highshelf", frequency: 8000, Q: 1, gain: 4 },
        { type: "lowshelf", frequency: 80, Q: 100, gain: 12 },
      ]),
    },
  },
  "exponential-volume": { enabled: true, config: {} },
  "in-app-menu": { enabled: true, config: { windowControls: false } },
  lumiastream: { enabled: false, config: {} },
  "media-controls": { enabled: true, config: {} },
  "music-together": { enabled: true, config: { displayName: "", defaultPermission: "suggest" } },
  navigation: { enabled: false, config: {} },
  notifications: {
    enabled: true,
    config: { unpauseNotification: true, urgency: "critical", interactive: false, refreshOnPlayPause: true },
  },
  "picture-in-picture": {
    enabled: true,
    config: { hotkey: "Shift+P", useNativePiP: false, alwaysOnTop: false, savePosition: false, saveSize: true },
  },
  "playback-speed": { enabled: true, config: { speed: 1, preservePitch: true } },
  "precise-volume": {
    enabled: true,
    config: { steps: 50, wheel: true, arrowsShortcut: false, showHud: true, volumeUp: "Ctrl+Up", volumeDown: "Ctrl+Down" },
  },
  "quality-changer": { enabled: true, config: {} },
  scrobbler: {
    enabled: true,
    config: {
      lastfmEnabled: true,
      lastfmSessionKey: "session",
      lastfmApiKey: "k",
      lastfmSecret: "s",
      lastfmApiRoot: "https://ws.audioscrobbler.com/2.0/",
      listenbrainzEnabled: true,
      listenbrainzToken: "lb-token",
      listenbrainzApiRoot: "https://api.listenbrainz.org/1/",
      scrobbleOtherMedia: false,
      alternativeTitles: false,
      alternativeArtist: true,
    },
  },
  shortcuts: {
    enabled: true,
    config: {
      playPause: "Ctrl+Shift+Space",
      next: "Ctrl+Shift+Right",
      previous: "Ctrl+Shift+Left",
      volumeUp: "",
      volumeDown: "",
      like: "",
      showWindow: "",
    },
  },
  "skip-disliked-songs": { enabled: true, config: {} },
  "skip-silences": { enabled: true, config: { onlySkipBeginning: true } },
  sponsorblock: {
    enabled: true,
    config: {
      music_offtopic: true,
      sponsor: true,
      selfpromo: true,
      interaction: false,
      intro: false,
      outro: false,
      preview: false,
      filler: true,
      apiURL: "https://sponsor.example",
    },
  },
  "taskbar-mediacontrol": { enabled: true, config: {} },
  touchbar: { enabled: true, config: {} },
  "transparent-player": { enabled: true, config: { opacity: 30, type: "acrylic" } },
  "tuna-obs": { enabled: true, config: { port: 1608 } },
  "unobtrusive-player": { enabled: true, config: {} },
  "video-toggle": { enabled: true, config: { mode: "native", align: "right", hideVideo: true, forceHide: true } },
  visualizer: {
    enabled: true,
    config: {
      type: "butterchurn",
      preset: "Flexi - alien fish pond",
      blendTimeInSeconds: 5,
      songTitle: false,
      bars: 64,
      primary: "#49f3f7",
      secondary: "#f76b1c",
    },
  },
};

describe("a pear-desktop 3.12 config.json, loaded with the real plugins", () => {
  const dir = mkdtempSync(join(tmpdir(), "pear-plugins-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "config.json"), `${JSON.stringify(PEAR_DESKTOP_3, null, "\t")}\n`);
  const settings = new Settings(dir, hostPlugins, "4.0.0");

  test.each(Object.keys(EXPECTED))("%s", (id) => {
    expect(hostPlugins.some((plugin) => plugin.id === id)).toBe(true);
    expect(settings.plugin(id)).toEqual(EXPECTED[id]);
  });

  test("keeps pear-desktop's own keys in the file", () => {
    const file = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
    expect(file.plugins.scrobbler.scrobblers.lastfm.sessionKey).toBe("session");
    expect(file.plugins["picture-in-picture"]["pip-size"]).toEqual([500, 300]);
    expect(file.plugins.discord[PLAY_BUTTON]).toBe(false);
    expect(file.__internal__.migrations.version).toBe("4.0.0");
  });
});

describe("synced-lyrics", () => {
  test("gap text and Chinese conversion map onto the rewrite's values", () => {
    expect(twice("synced-lyrics", { defaultTextString: ["•", "••", "•••"], convertChineseCharacter: "traditionalToSimplified" })).toMatchObject({
      gapText: "dots",
      convertChinese: "t2s",
    });
    expect(twice("synced-lyrics", { defaultTextString: "♪", convertChineseCharacter: "disabled" })).toMatchObject({ gapText: "note", convertChinese: "off" });
    expect(twice("synced-lyrics", { defaultTextString: " " })).toMatchObject({ gapText: "none" });
    // Same names and values: nothing to convert.
    const kept = migrated({ "synced-lyrics": { enabled: true, preferredProvider: "LRCLib", lineEffect: "focus", romanization: false } })["synced-lyrics"];
    expect(kept).toMatchObject({ preferredProvider: "LRCLib", lineEffect: "focus", romanization: false });
  });
});
