import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config, definePlugin } from "@pear/sdk";
import { afterAll, describe, expect, test, vi } from "vitest";
import { Settings } from "../src/main/config.ts";
import { compareVersions, migrate } from "../src/main/migrations.ts";

vi.mock("electron", () => ({}));

const tray = definePlugin({
  id: "tray",
  name: "Tray icon",
  enabledByDefault: true,
  config: { clickPlayPause: config.bool(false, { label: "Click toggles playback" }) },
});
const lyrics = definePlugin({
  id: "synced-lyrics",
  name: "Synced lyrics",
  config: {
    preciseTiming: config.bool(true, { label: "Precise timing" }),
    lineEffect: config.select("fancy", [{ value: "fancy", label: "Fancy" }, { value: "scale", label: "Scale" }], { label: "Effect" }),
  },
});
const clock = definePlugin({ id: "clock", name: "Clock", enabledByDefault: false });
/** The downloader's options that pear-desktop 3.x had (or has a migration for). */
const downloader = definePlugin({
  id: "downloader",
  name: "Downloader",
  config: {
    downloadFolder: config.string("", { label: "Folder" }),
    format: config.select("mp3", [{ value: "mp3", label: "MP3" }, { value: "m4a", label: "M4A" }, { value: "opus", label: "Opus" }, { value: "source", label: "Source" }], {
      label: "Format",
    }),
    playlistMaxItems: config.number(0, { label: "Limit", min: 0, max: 5000 }),
    skipExisting: config.bool(true, { label: "Skip existing" }),
    autoDownload: config.bool(false, { label: "Auto" }),
    autoDownloadMode: config.select("seconds", [{ value: "seconds", label: "Seconds" }, { value: "percent", label: "Percent" }], { label: "When" }),
    autoDownloadSeconds: config.number(20, { label: "Seconds", min: 1, max: 600 }),
    autoDownloadPercent: config.number(10, { label: "Percent", min: 1, max: 100 }),
    autoDownloadFolder: config.string("", { label: "Auto folder" }),
  },
});
const PLUGINS = [tray, lyrics, clock, downloader];

/** What pear-desktop 3.12 leaves in config.json (electron-store, tab-indented). */
const PEAR_DESKTOP_3 = {
  "window-size": { width: 1100, height: 550 },
  "window-maximized": true,
  "window-position": { x: 40, y: 60 },
  url: "https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/playlist?list=LM",
  options: {
    tray: true,
    trayClickPlayPause: true,
    appVisible: false,
    autoUpdates: false,
    alwaysOnTop: true,
    disableHardwareAcceleration: true,
    resumeOnStart: false,
    startingPage: "Explore",
    likeButtons: "hide",
    themes: ["/home/me/theme.css"],
    language: "el",
    hideMenuWarned: true,
  },
  plugins: {
    "synced-lyrics": { enabled: true, preciseTiming: false, lineEffect: "scale", showTimeCodes: true },
    "api-server": { enabled: true, port: 9000, authorizedClients: ["remote"], secret: "s3cret", hostname: "0.0.0.0" },
    "do-not-track": { enabled: true, blocker: "In player" },
    downloader: {
      enabled: true,
      downloadFolder: "/home/me/Music/YTM",
      downloadOnFinish: { enabled: true, seconds: 30, percent: 80, mode: "percent", folder: "/home/me/Music/Auto" },
      selectedPreset: "Source",
      customPresetSetting: { extension: "mp3", ffmpegArgs: ["-b:a", "256k"] },
      skipExisting: true,
      playlistMaxItems: 50,
    },
  },
  __internal__: { migrations: { version: "3.12.0" } },
};

const profiles: string[] = [];
afterAll(() => profiles.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function profile(contents?: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "pear-config-"));
  profiles.push(dir);
  if (contents !== undefined) writeFileSync(join(dir, "config.json"), `${JSON.stringify(contents, null, "\t")}\n`);
  return dir;
}

const saved = (dir: string) => JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));

describe("config.json from pear-desktop 3.x", () => {
  const dir = profile(PEAR_DESKTOP_3);
  const settings = new Settings(dir, PLUGINS, "4.0.0");

  test("keeps plugin states and same-named options", () => {
    expect(settings.plugin("synced-lyrics")).toEqual({ enabled: true, config: { preciseTiming: false, lineEffect: "scale" } });
    // Not in the old file: the plugin's own default.
    expect(settings.plugin("clock")).toEqual({ enabled: false, config: {} });
  });

  test("maps app options onto the core sections", () => {
    expect(settings.core("general")).toMatchObject({ resumeOnStart: false, startingPage: "Explore", autoUpdates: false });
    expect(settings.core("window")).toMatchObject({ alwaysOnTop: true, appVisible: false });
    expect(settings.core("advanced")).toMatchObject({ disableHardwareAcceleration: true });
    expect(settings.core("appearance")).toMatchObject({ likeButtons: "hide", themes: ["/home/me/theme.css"] });
  });

  test("moves the tray option onto the tray plugin", () => {
    expect(settings.plugin("tray")).toEqual({ enabled: true, config: { clickPlayPause: true } });
  });

  test("reads the API server where the plugin kept it", () => {
    expect(settings.core("apiServer")).toMatchObject({ enabled: true, port: 9000, authorizedClients: ["remote"], secret: "s3cret" });
  });

  test("maps the downloader's presets and download-on-finish settings", () => {
    expect(settings.plugin("downloader")).toEqual({
      enabled: true,
      config: {
        downloadFolder: "/home/me/Music/YTM",
        format: "source",
        playlistMaxItems: 50,
        skipExisting: true,
        autoDownload: true,
        autoDownloadMode: "percent",
        autoDownloadSeconds: 30,
        autoDownloadPercent: 80,
        autoDownloadFolder: "/home/me/Music/Auto",
      },
    });
    // The old keys stay for pear-desktop 3.x.
    expect(saved(dir).plugins.downloader).toMatchObject({ selectedPreset: "Source", downloadOnFinish: { enabled: true } });
  });

  test("reads the window state and last page", () => {
    expect(settings.window).toEqual({ width: 1100, height: 550, x: 40, y: 60, maximized: true });
    expect(settings.lastUrl).toBe("https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/playlist?list=LM");
  });

  test("records the migration at once and keeps unknown keys", () => {
    const file = saved(dir);
    expect(file.__internal__.migrations.version).toBe("4.0.0");
    expect(file.options).toMatchObject({ language: "el", hideMenuWarned: true });
    expect(file.plugins["synced-lyrics"].showTimeCodes).toBe(true);
    expect(file.plugins["do-not-track"]).toEqual({ enabled: true, blocker: "In player" });
    expect(readFileSync(join(dir, "config.json"), "utf8")).toMatch(/^\{\n\t"/);
  });

  test("writes changes back in the same layout", () => {
    settings.setPlugin(clock, { enabled: true });
    settings.setCore("window", { alwaysOnTop: false });
    settings.setCore("apiServer", { authorizedClients: ["remote", "phone"] });
    settings.window = { width: 800, height: 600, maximized: false };
    settings.flush();
    const file = saved(dir);
    expect(file.plugins.clock).toEqual({ enabled: true });
    expect(file.options.alwaysOnTop).toBe(false);
    expect(file.plugins["api-server"]).toMatchObject({ authorizedClients: ["remote", "phone"], port: 9000 });
    expect(file["window-size"]).toEqual({ width: 800, height: 600 });
  });
});

describe("migrations", () => {
  test("a fresh profile starts from defaults at the running version", () => {
    const dir = profile();
    const settings = new Settings(dir, PLUGINS, "4.0.0");
    expect(settings.plugin("tray")?.enabled).toBe(true);
    expect(settings.core("general").startingPage).toBe("");
    expect(saved(dir).__internal__.migrations.version).toBe("4.0.0");
  });

  test("run once", () => {
    const first = migrate(structuredClone(PEAR_DESKTOP_3), "4.0.0");
    expect(first.migrated).toBe(true);
    first.config.options!.tray = false;
    const second = migrate(first.config, "4.0.0");
    expect(second.migrated).toBe(false);
    // The 4.0.0 migration didn't run again.
    expect(second.config.plugins!.tray!.enabled).toBe(true);
  });

  test("a newer file (downgrade) is left alone", () => {
    const { config: result } = migrate({ options: { tray: true }, __internal__: { migrations: { version: "5.1.0" } } }, "4.0.0");
    expect(result.plugins?.tray).toBeUndefined();
    expect(result.__internal__!.migrations!.version).toBe("5.1.0");
  });

  test("invalid values fall back to defaults", () => {
    const dir = profile({ options: { startingPage: "Nowhere", alwaysOnTop: "yes" }, __internal__: { migrations: { version: "4.0.0" } } });
    const settings = new Settings(dir, PLUGINS, "4.0.0");
    expect(settings.core("general").startingPage).toBe("");
    expect(settings.core("window").alwaysOnTop).toBe(false);
  });

  test("downloader presets become formats", () => {
    const format = (entry: Record<string, unknown>) =>
      migrate({ plugins: { downloader: { enabled: true, ...entry } }, __internal__: { migrations: { version: "3.12.0" } } }, "4.0.0").config.plugins!
        .downloader!.format;
    expect(format({ selectedPreset: "mp3 (256kbps)" })).toBe("mp3");
    expect(format({ selectedPreset: "Source" })).toBe("source");
    expect(format({ selectedPreset: "Custom", customPresetSetting: { extension: "opus", ffmpegArgs: [] } })).toBe("opus");
    expect(format({ selectedPreset: "Custom", customPresetSetting: { extension: null, ffmpegArgs: ["-acodec", "copy"] } })).toBe("source");
    // Containers yt-dlp isn't asked for keep the default.
    expect(format({ selectedPreset: "Custom", customPresetSetting: { extension: "flac", ffmpegArgs: [] } })).toBeUndefined();
    expect(format({})).toBeUndefined();
  });

  test("download on finish without a folder or mode keeps the defaults", () => {
    const entry = migrate(
      { plugins: { downloader: { enabled: false, downloadOnFinish: { enabled: false, seconds: 5 } } }, __internal__: { migrations: { version: "3.12.0" } } },
      "4.0.0",
    ).config.plugins!.downloader!;
    expect(entry).toMatchObject({ autoDownload: false, autoDownloadSeconds: 5 });
    expect(entry).not.toHaveProperty("autoDownloadMode");
    expect(entry).not.toHaveProperty("autoDownloadFolder");
  });

  test("versions compare numerically", () => {
    expect(compareVersions("3.12.0", "4.0.0")).toBe(-1);
    expect(compareVersions("3.9.0", "3.12.0")).toBe(-1);
    expect(compareVersions("4.0.0", "4.0.0-beta.1")).toBe(0);
  });
});
