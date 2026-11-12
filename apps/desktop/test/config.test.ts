import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config, definePlugin } from "@pear/sdk";
import { afterAll, describe, expect, test, vi } from "vitest";
import { Settings } from "../src/main/config.ts";
import { migrate } from "../src/main/migrations/index.ts";
import { compareVersions } from "../src/main/version.ts";
import { from312, PEAR_DESKTOP_3 } from "./pear-desktop-3.ts";

vi.mock("electron", () => ({}));

const tray = definePlugin({
  id: "tray",
  name: "Tray icon",
  enabledByDefault: true,
  config: {
    closeToTray: config.bool(false, { label: "Close to tray" }),
    clickPlayPause: config.bool(false, { label: "Click toggles playback" }),
  },
});
const lyrics = definePlugin({
  id: "synced-lyrics",
  name: "Synced lyrics",
  config: {
    preciseTiming: config.bool(true, { label: "Precise timing" }),
    lineEffect: config.select("fancy", [{ value: "fancy", label: "Fancy" }, { value: "scale", label: "Scale" }], { label: "Effect" }),
  },
});
/** Not in PEAR_DESKTOP_3. */
const genius = definePlugin({ id: "lyrics-genius", name: "Genius lyrics", enabledByDefault: false });
const menu = definePlugin({ id: "in-app-menu", name: "In-app menu", enabledByDefault: ["win32"] });
/** The downloader's options that pear-desktop 3.x had (or has a migration for). */
const downloader = definePlugin({
  id: "downloader",
  name: "Downloader",
  config: {
    downloadFolder: config.string("", { label: "Folder" }),
    exportFiles: config.bool(false, { label: "Export" }),
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
const PLUGINS = [tray, lyrics, genius, menu, downloader];

const profiles: string[] = [];
afterAll(() => profiles.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function profile(contents?: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "pear-config-"));
  profiles.push(dir);
  if (contents !== undefined) writeFileSync(join(dir, "config.json"), `${JSON.stringify(contents, null, "\t")}\n`);
  return dir;
}

const saved = (dir: string) => JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));

/** Settings loaded from a new profile with this config.json (none: a fresh profile). */
const load = (stored?: unknown, platform?: string) => new Settings(profile(stored), PLUGINS, "4.0.0", platform);
/** The 4.0.0 migration's result for a file pear-desktop 3.12 wrote. */
const migrated312 = (stored: object) => migrate(from312(stored) as never, "4.0.0");

describe("config.json from pear-desktop 3.x", () => {
  const dir = profile(PEAR_DESKTOP_3);
  const settings = new Settings(dir, PLUGINS, "4.0.0");

  test("keeps plugin states and same-named options", () => {
    expect(settings.plugin("synced-lyrics")).toEqual({ enabled: true, config: { preciseTiming: false, lineEffect: "scale" } });
    // Not in the old file: the plugin's own default.
    expect(settings.plugin("lyrics-genius")).toEqual({ enabled: false, config: {} });
  });

  test("maps app options onto the core sections", () => {
    expect(settings.core("general")).toMatchObject({ resumeOnStart: false, startingPage: "Explore", autoUpdates: false });
    expect(settings.core("window")).toMatchObject({ alwaysOnTop: true, appVisible: false });
    expect(settings.core("advanced")).toMatchObject({ disableHardwareAcceleration: true });
    expect(settings.core("appearance")).toMatchObject({ likeButtons: "hide", themes: ["/home/me/theme.css"] });
  });

  test("moves the tray option onto the tray plugin", () => {
    // With the tray on, pear-desktop hid the window when it was closed.
    expect(settings.plugin("tray")).toEqual({ enabled: true, config: { closeToTray: true, clickPlayPause: true } });
    const off = (options: Record<string, unknown>) => migrated312({ options }).config.plugins?.tray;
    expect(off({ tray: false })).toEqual({ enabled: false });
    expect(off({})).toBeUndefined();
  });

  test("reads the API server where the plugin kept it", () => {
    expect(settings.core("apiServer")).toMatchObject({ enabled: true, port: 9000, authorizedClients: ["remote"], secret: "s3cret" });
  });

  test("the API server keeps listening on every interface, pear-desktop's default", () => {
    const apiServer = (entry: Record<string, unknown>) => load(from312({ plugins: { "api-server": entry } })).core("apiServer");
    expect(apiServer({ enabled: true, authorizedClients: ["phone"] })).toMatchObject({ enabled: true, hostname: "0.0.0.0" });
    expect(apiServer({ enabled: true, hostname: "127.0.0.1" })).toMatchObject({ hostname: "127.0.0.1" });
    // Never set up in pear-desktop, or a new profile: this machine only.
    expect(load(from312({})).core("apiServer")).toMatchObject({ hostname: "127.0.0.1" });
    expect(load().core("apiServer")).toMatchObject({ hostname: "127.0.0.1" });
  });

  test("performance-improvement stays on unless it was turned off (on by default in pear-desktop)", () => {
    const performance = (plugins: Record<string, unknown>) => migrated312({ plugins }).config.plugins?.["performance-improvement"];
    expect(performance({})).toEqual({ enabled: true });
    expect(performance({ "performance-improvement": { enabled: false } })).toEqual({ enabled: false });
    // New profiles: off, the rewrite's default.
    expect(migrate(undefined, "4.0.0").config.plugins).toBeUndefined();
  });

  test("everyone upgrading keeps the downloader saving files to the folder; new profiles keep songs in the app", () => {
    expect(migrated312({}).config.plugins?.downloader).toMatchObject({ exportFiles: true });
    expect(migrated312({ plugins: { downloader: { exportFiles: false } } }).config.plugins?.downloader).toMatchObject({ exportFiles: false });
    expect(load().plugin("downloader")?.config).toMatchObject({ exportFiles: false });
  });

  test("maps the downloader's presets and download-on-finish settings", () => {
    expect(settings.plugin("downloader")).toEqual({
      enabled: true,
      config: {
        downloadFolder: "/home/me/Music/YTM",
        exportFiles: true,
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
    settings.setPlugin(genius, { enabled: true });
    settings.setCore("window", { alwaysOnTop: false });
    settings.setCore("apiServer", { authorizedClients: ["remote", "phone"] });
    settings.window = { width: 800, height: 600, maximized: false };
    settings.flush();
    const file = saved(dir);
    expect(file.plugins["lyrics-genius"]).toEqual({ enabled: true });
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
    const settings = load({ options: { startingPage: "Nowhere", alwaysOnTop: "yes" }, __internal__: { migrations: { version: "4.0.0" } } });
    expect(settings.core("general").startingPage).toBe("");
    expect(settings.core("window").alwaysOnTop).toBe(false);
  });

  test("downloader presets become formats; the Custom preset keeps its arguments", () => {
    const downloader = (entry: Record<string, unknown>) => migrated312({ plugins: { downloader: { enabled: true, ...entry } } }).config.plugins!.downloader!;
    expect(downloader({ selectedPreset: "mp3 (256kbps)" }).format).toBe("mp3");
    expect(downloader({ selectedPreset: "Source" }).format).toBe("source");
    expect(downloader({ selectedPreset: "Custom", customPresetSetting: { extension: "flac", ffmpegArgs: ["-compression_level", "8", "-metadata", "comment=a b"] } })).toMatchObject({
      format: "custom",
      customArgs: '-compression_level 8 -metadata "comment=a b"',
      customExtension: "flac",
    });
    expect(downloader({ selectedPreset: "Custom", customPresetSetting: { extension: null, ffmpegArgs: ["-acodec", "copy"] } })).toMatchObject({
      format: "custom",
      customArgs: "-acodec copy",
    });
    expect(downloader({}).format).toBeUndefined();
  });

  test("downloader: overwriting stays pear-desktop's default for its users", () => {
    const downloaderOf = (entry: Record<string, unknown>) => load(from312({ plugins: { downloader: entry } })).plugin("downloader")!.config;
    expect(downloaderOf({ enabled: true })).toMatchObject({ skipExisting: false });
    expect(downloaderOf({ enabled: true, skipExisting: true })).toMatchObject({ skipExisting: true });
    expect(load().plugin("downloader")!.config).toMatchObject({ skipExisting: true });
  });

  test("download on finish without a folder or mode keeps the defaults", () => {
    const entry = migrated312({ plugins: { downloader: { enabled: false, downloadOnFinish: { enabled: false, seconds: 5 } } } }).config.plugins!.downloader!;
    expect(entry).toMatchObject({ autoDownload: false, autoDownloadSeconds: 5 });
    expect(entry).not.toHaveProperty("autoDownloadMode");
    expect(entry).not.toHaveProperty("autoDownloadFolder");
  });

  test("picture-in-picture: the small window's saved bounds move to their own file", () => {
    const old = (entry: Record<string, unknown>) => from312({ plugins: { "picture-in-picture": entry } });
    expect(migrated312(old({ "pip-position": [120.4, 80], "pip-size": [640, 360] })).files).toEqual({
      "picture-in-picture.json": { x: 120, y: 80, width: 640, height: 360 },
    });
    expect(migrated312(old({ "pip-position": "broken", "pip-size": [0, 0] })).files).toEqual({});

    // Written next to config.json, unless the rewrite already saved bounds there.
    const dir = profile(old({ enabled: true, "pip-position": [5, 6] }));
    new Settings(dir, PLUGINS, "4.0.0");
    expect(JSON.parse(readFileSync(join(dir, "picture-in-picture.json"), "utf8"))).toEqual({ x: 5, y: 6 });
    const kept = profile(old({ enabled: true, "pip-position": [5, 6] }));
    writeFileSync(join(kept, "picture-in-picture.json"), '{"x":1}');
    new Settings(kept, PLUGINS, "4.0.0");
    expect(readFileSync(join(kept, "picture-in-picture.json"), "utf8")).toBe('{"x":1}');
  });

  test("a plugin can be enabled by default on some platforms only", () => {
    const enabled = (platform: string, stored?: unknown) => load(stored, platform).plugin("in-app-menu")!.enabled;
    expect(enabled("win32")).toBe(true);
    expect(enabled("linux")).toBe(false);
    expect(enabled("darwin")).toBe(false);
    // pear-desktop's Windows users who never turned it off keep it; a stored choice wins.
    expect(enabled("win32", from312({ plugins: {} }))).toBe(true);
    expect(enabled("win32", from312({ plugins: { "in-app-menu": { enabled: false } } }))).toBe(false);
    expect(enabled("linux", from312({ plugins: { "in-app-menu": { enabled: true } } }))).toBe(true);
  });

  test("versions compare numerically", () => {
    expect(compareVersions("3.12.0", "4.0.0")).toBe(-1);
    expect(compareVersions("3.9.0", "3.12.0")).toBe(-1);
    expect(compareVersions("4.0.0", "4.0.0-beta.1")).toBe(0);
  });
});

describe("files from before pear-desktop 3.12", () => {
  test("the ad blocker becomes do-not-track, as pear-desktop 3.12 did", () => {
    const { config: result } = migrate(
      { plugins: { adblocker: { enabled: true, blocker: "Electron", cache: false } }, __internal__: { migrations: { version: "3.10.0" } } },
      "4.0.0",
    );
    expect(result.plugins?.adblocker).toBeUndefined();
    expect(result.plugins?.["do-not-track"]).toEqual({ enabled: true, blocker: "In player", cache: false });
  });

  test("3.12+ files are left to the 4.0.0 migration", () => {
    const { config: result } = migrated312({ plugins: { adblocker: { enabled: true } } });
    expect(result.plugins?.adblocker).toEqual({ enabled: true });
  });
});

describe("a damaged config.json", () => {
  test("is kept next to the new one before defaults replace it", () => {
    const dir = profile();
    writeFileSync(join(dir, "config.json"), '{"plugins": {"tray": {"enabled": fal');
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const settings = new Settings(dir, PLUGINS, "4.0.0");
    expect(settings.plugin("tray")?.enabled).toBe(true);
    const backups = readdirSync(dir).filter((name) => name.startsWith("config.json.damaged-"));
    expect(backups).toHaveLength(1);
    expect(readFileSync(join(dir, backups[0]!), "utf8")).toBe('{"plugins": {"tray": {"enabled": fal');
  });

  test("a fresh profile has nothing to keep", () => {
    const dir = profile();
    new Settings(dir, PLUGINS, "4.0.0");
    expect(readdirSync(dir).filter((name) => name.includes("damaged"))).toEqual([]);
  });
});
