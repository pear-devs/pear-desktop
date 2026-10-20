// downloader: a real download from the player-bar button with the built-in
// engine, with tags and cover art (native ffmpeg, and ffmpeg.wasm when there is
// none); the yt-dlp engine, downloading yt-dlp (and ffmpeg) when they aren't installed.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { ytmUrl } from "@pear/sdk/util";
import type { Page } from "@playwright/test";
import { expect, type Launch, test } from "./fixtures.ts";
import { pause } from "./helpers/playback.ts";
import { invoke, pluginError, pluginStatus, setConfig } from "./helpers/plugins.ts";
import { openSettings, pluginRow, searchbox } from "./helpers/settings.ts";
import { mainWindow, playTestTrack, TEST_TRACK } from "./launch.ts";
import { inBar } from "./helpers/player-bar.ts";

// Rick Astley, "Whenever You Need Somebody": an album page that works logged out.
const ALBUM_URL = ytmUrl("/playlist?list=OLAK5uy_nmDUsWOMoEcz0SsVqUwir0oxu-k1oUyXE");
/** Makes the plugin act as if neither is installed (see plugins/downloader/index.ts). */
const NO_SYSTEM_TOOLS = { PEAR_DOWNLOADER_IGNORE_SYSTEM_TOOLS: "1" };

const whichTool = (name: string) => {
  try {
    return execFileSync(process.platform === "win32" ? "where" : "which", [name], { encoding: "utf8" }).split(/\r?\n/)[0]!.trim();
  } catch {
    return undefined;
  }
};
const hasTool = (name: string) => !!whichTool(name);

const status = (page: Page) => pluginStatus(page, "downloader");
/** The folder's files, without the downloader's list of downloaded songs. */
const songFiles = (folder: string) => readdirSync(folder).filter((file) => !file.startsWith("."));

const ffprobe = <T>(file: string, ...show: string[]) =>
  JSON.parse(execFileSync("ffprobe", ["-v", "quiet", "-print_format", "json", ...show, file], { encoding: "utf8" })) as T;

interface Setup {
  launch: Launch;
  tempDir(prefix: string): string;
}

/**
 * Launches with the downloader saving to a fresh folder ("<title>.<ext>"), and
 * do-not-track to get through pre-rolls quickly.
 */
async function launchDownloader({ launch, tempDir }: Setup, config: Record<string, unknown>, env?: Record<string, string>) {
  const folder = tempDir("pear-downloads-");
  const app = await launch({
    ...(env ? { env } : {}),
    plugins: {
      downloader: { enabled: true, config: { downloadFolder: folder, template: "%(title)s.%(ext)s", ...config } },
      "do-not-track": { enabled: true },
    },
  });
  return { app, page: await mainWindow(app), folder };
}

/** Plays the test track, paused; the player-bar button and the toast. */
async function downloadButton(page: Page) {
  await playTestTrack(page);
  await pause(page);
  const button = page.locator(inBar(".pear-dl-button"));
  await expect(button).toBeVisible({ timeout: 15_000 });
  return { button, toast: page.locator(".pear-dl-toast") };
}

test("downloader saves the current song as a tagged mp3 from the player bar", async ({ launch, tempDir }) => {
  test.skip(!hasTool("yt-dlp") || !hasTool("ffmpeg"), "needs yt-dlp and ffmpeg");
  test.setTimeout(150_000);
  const { page, folder } = await launchDownloader({ launch, tempDir }, { format: "mp3", lyrics: true, lyricsFile: true });
  await expect
    .poll(() => invoke<{ capabilities: { ffmpeg: boolean } }>(page, "downloader", "info").catch(() => null))
    .toMatchObject({ capabilities: { ffmpeg: true } });

  const { button, toast } = await downloadButton(page);
  await expect(button).toHaveAttribute("title", "Download");
  await button.click();

  // Progress shows on the button, then a toast confirms.
  await expect(button).toHaveAttribute("data-busy", /downloading|converting/, { timeout: 30_000 });
  await expect(toast).toContainText("Saved", { timeout: 90_000 });
  await expect(toast.getByRole("button", { name: "Show" })).toBeVisible();
  await expect(button).not.toHaveAttribute("data-busy");
  const { recent } = await invoke<{ recent: { engine: string; files: string[] }[] }>(page, "downloader", "state");
  expect(recent[0]!.engine).toBe("built-in");

  // The menu now lists it.
  await button.click();
  await expect(page.locator(".pear-dl-menu-heading")).toHaveText("Recent downloads");
  await expect(page.locator(".pear-dl-menu").getByRole("menuitem", { name: /^Show “.+” in its folder$/ })).toBeVisible();
  await page.keyboard.press("Escape");

  expect(await status(page)).toBe(
    "Downloading with the built-in downloader, converting with ffmpeg (installed on this computer); yt-dlp (installed on this computer) takes over when that fails.",
  );

  // The song, and its synced lyrics from LRCLib next to it.
  const files = songFiles(folder).sort();
  expect(files).toEqual([expect.stringMatching(/\.lrc$/), expect.stringMatching(/\.mp3$/)]);
  expect(readFileSync(join(folder, files[0]!), "utf8")).toMatch(/^\[\d\d:\d\d\.\d\d\]/m);
  files.shift();
  const tags = ffprobe<{ format: { tags: Record<string, string> }; streams: { codec_type: string; width?: number; height?: number }[] }>(
    join(folder, files[0]!),
    "-show_format",
    "-show_streams",
  );
  const title = await page.evaluate(() => window.__pearRuntime!.player.state.track!.title);
  expect(tags.format.tags.title).toContain(title);
  expect(tags.format.tags.artist).toBeTruthy();
  // ffprobe names the USLT frame by its language.
  expect(tags.format.tags["lyrics-eng"]).toBeTruthy();
  const cover = tags.streams.find((s) => s.codec_type === "video");
  expect(cover).toBeTruthy();
  expect(cover!.width).toBe(cover!.height);

  // Renamed, it still counts as downloaded: the folder's archive knows the song.
  renameSync(join(folder, files[0]!), join(folder, "renamed.mp3"));
  await button.click();
  await page.locator(".pear-dl-menu").getByRole("menuitem", { name: "Download song" }).click();
  await expect.poll(async () => (await invoke<{ recent: unknown[] }>(page, "downloader", "state")).recent.length).toBe(2);
  expect(songFiles(folder).sort()).toEqual([expect.stringMatching(/\.lrc$/), "renamed.mp3"]);

  // A missing yt-dlp is reported in settings.
  await setConfig(page, "downloader", { ytDlpPath: "/nonexistent/yt-dlp" });
  await expect.poll(() => pluginError(page, "downloader")).toMatch(/yt-dlp was not found/);
});

test("downloader downloads yt-dlp when it isn't installed, and says so when offline", async ({ launch, tempDir }) => {
  test.setTimeout(240_000);
  const ffmpeg = whichTool("ffmpeg");
  test.skip(!ffmpeg || !hasTool("ffprobe"), "needs ffmpeg (only yt-dlp is downloaded here)");
  const { app, page, folder } = await launchDownloader(
    { launch, tempDir },
    { engine: "yt-dlp", format: "opus", ffmpegPath: dirname(ffmpeg!) },
    NO_SYSTEM_TOOLS,
  );
  await expect.poll(() => status(page), { timeout: 20_000 }).toBe(
    "yt-dlp isn't installed; it will be downloaded the first time you download a song.",
  );
  const { button, toast } = await downloadButton(page);

  await test.step("offline (a proxy nobody listens on): a clear message, and nothing left behind", async () => {
    await app.evaluate(({ session }) => session.defaultSession.setProxy({ proxyRules: "http://127.0.0.1:9" }));
    await button.click();
    await expect(toast).toContainText("Download failed: Couldn't download yt-dlp", { timeout: 20_000 });
    await expect(toast).toContainText("Check your internet connection and try again.");
    await expect.poll(() => status(page)).toMatch(/^Couldn't download yt-dlp .*internet connection/);
    expect(existsSync(join(app.userData, "bin", "yt-dlp"))).toBe(false);
    await app.evaluate(({ session }) => session.defaultSession.setProxy({ mode: "direct" }));
  });

  await test.step("online: yt-dlp is downloaded (with progress on the button), then the song", async () => {
    // The failed download is in the menu now, to try again.
    await button.click();
    await page.locator(".pear-dl-menu").getByRole("menuitem", { name: /^Retry “.+”$/ }).click();
    await expect(toast).toContainText("Downloading yt-dlp, which saving songs needs", { timeout: 20_000 });
    await expect(button).toHaveAttribute("title", /^(Downloading|Checking) yt-dlp/);
    await expect.poll(() => status(page), { timeout: 20_000 }).toMatch(/^(Downloading yt-dlp… \d+%|Checking yt-dlp…)$/);
    await expect(toast).toContainText("Saved", { timeout: 180_000 });
  });

  const info = await invoke<{ ytDlp: string; sources: { ytDlp: string; ffmpeg: string }; capabilities: { mutagen: boolean } }>(
    page,
    "downloader",
    "info",
  );
  expect(info.sources).toEqual({ ytDlp: "managed", ffmpeg: "configured" });
  expect(info.ytDlp).toBe(join(app.userData, "bin", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp"));
  // The standalone build has mutagen, so even Opus files get their cover.
  expect(info.capabilities.mutagen).toBe(true);
  const installed = JSON.parse(readFileSync(join(app.userData, "bin", "tools.json"), "utf8")) as { ytDlp: { sha256: string } };
  expect(installed.ytDlp.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(await status(page)).toMatch(/^Using yt-dlp \S+ \(downloaded automatically\) and ffmpeg \(set in the settings\)\.$/);

  // The settings show it on the plugin's card.
  await openSettings(page);
  await searchbox(page).fill("downloader");
  const statusText = pluginRow(page, "downloader").locator(".status-text");
  await expect(statusText).toContainText("yt-dlp", { timeout: 10_000 });
  await expect(statusText).toContainText("(downloaded automatically)");
  await page.keyboard.press("Escape");

  const files = songFiles(folder);
  expect(files).toHaveLength(1);
  expect(files[0]).toMatch(/\.opus$/);
  const { streams } = ffprobe<{ streams: { codec_type: string }[] }>(join(folder, files[0]!), "-show_streams");
  expect(streams.some((s) => s.codec_type === "video")).toBe(true);
});

// Downloads ffmpeg too (60-160 MB, depending on the platform), so only on request.
test("downloader downloads yt-dlp and ffmpeg when neither is installed", async ({ launch, tempDir }) => {
  test.skip(process.env.PEAR_E2E_FFMPEG_DOWNLOAD !== "1", "set PEAR_E2E_FFMPEG_DOWNLOAD=1 to download ffmpeg");
  test.setTimeout(600_000);
  const { app, page, folder } = await launchDownloader({ launch, tempDir }, { engine: "yt-dlp", format: "mp3" }, NO_SYSTEM_TOOLS);
  await expect.poll(() => status(page), { timeout: 20_000 }).toBe(
    "yt-dlp and ffmpeg aren't installed; they will be downloaded the first time you download a song.",
  );
  const { button, toast } = await downloadButton(page);
  await button.click();
  await expect(toast).toContainText("Downloading ffmpeg", { timeout: 120_000 });
  await expect(toast).toContainText("Saved", { timeout: 540_000 });
  const info = await invoke<{ sources: unknown; ffmpeg: string }>(page, "downloader", "info");
  expect(info.sources).toEqual({ ytDlp: "managed", ffmpeg: "managed" });
  expect(info.ffmpeg).toBe(join(app.userData, "bin", "ffmpeg"));
  expect(songFiles(folder)).toEqual([expect.stringMatching(/\.mp3$/)]);
});

test("downloader converts with ffmpeg.wasm when there is no ffmpeg, without downloading anything", async ({ launch, tempDir }) => {
  test.skip(!hasTool("ffprobe"), "needs ffprobe to check the file");
  test.setTimeout(150_000);
  const { app, page, folder } = await launchDownloader({ launch, tempDir }, { format: "mp3", replayGain: true }, NO_SYSTEM_TOOLS);
  await expect.poll(() => status(page), { timeout: 20_000 }).toBe(
    "Downloading with the built-in downloader, converting with the built-in ffmpeg; yt-dlp is downloaded when that fails.",
  );
  const { button, toast } = await downloadButton(page);
  await button.click();
  await expect(toast).toContainText("Saved", { timeout: 120_000 });
  // Neither yt-dlp nor ffmpeg was needed.
  expect(existsSync(join(app.userData, "bin"))).toBe(false);
  const files = songFiles(folder);
  expect(files).toEqual([expect.stringMatching(/\.mp3$/)]);
  const { format, streams } = ffprobe<{ format: { tags: Record<string, string> }; streams: { codec_type: string; width?: number; height?: number }[] }>(
    join(folder, files[0]!),
    "-show_format",
    "-show_streams",
  );
  expect(format.tags.title).toBeTruthy();
  expect(format.tags.artist).toBeTruthy();
  // ffmpeg.wasm measured the loudness.
  expect(format.tags.REPLAYGAIN_TRACK_GAIN).toMatch(/^[+-]\d+\.\d\d dB$/);
  // node-id3 wrote the cover, square.
  const cover = streams.find((s) => s.codec_type === "video");
  expect(cover?.width).toBe(cover?.height);
});

test("downloader saves an album into its own folder, two songs at a time, with the album's tags", async ({ launch, tempDir }) => {
  test.skip(!hasTool("ffmpeg") || !hasTool("ffprobe"), "needs ffmpeg");
  test.setTimeout(150_000);
  const { page, folder } = await launchDownloader({ launch, tempDir }, { format: "opus", playlistMaxItems: 2, replayGain: true });
  await expect.poll(() => invoke(page, "downloader", "state").catch(() => null)).toBeTruthy();
  await invoke(page, "downloader", "download", { videoId: "", playlistId: new URL(ALBUM_URL).searchParams.get("list")! }, "album");
  await expect
    .poll(async () => (await invoke<{ recent: unknown[] }>(page, "downloader", "state")).recent, { timeout: 120_000 })
    .toEqual([expect.objectContaining({ engine: "built-in", files: [expect.any(String), expect.any(String)] })]);
  expect(songFiles(folder)).toEqual(["Whenever You Need Somebody"]);
  const album = join(folder, "Whenever You Need Somebody");
  const tracks = songFiles(album)
    .sort()
    .map((file) => ffprobe<{ streams: { codec_type: string; tags?: Record<string, string> }[] }>(join(album, file), "-show_streams"));
  // Ogg keeps the tags on the audio stream; ffprobe shows the cover's picture block as a picture stream.
  const tags = tracks.map(({ streams }) => streams.find((s) => s.codec_type === "audio")!.tags!);
  expect(tags.map((t) => t.track).sort()).toEqual(["1/2", "2/2"]);
  for (const t of tags) {
    expect(t).toMatchObject({ album: "Whenever You Need Somebody", album_artist: "Rick Astley", date: "1987" });
    expect(t.R128_TRACK_GAIN).toMatch(/^-?\d+$/);
  }
  for (const { streams } of tracks) expect(streams.some((s) => s.codec_type === "video")).toBe(true);
});

test("downloader leaves nothing half-written when a download is cancelled", async ({ launch, tempDir }) => {
  test.setTimeout(120_000);
  const { page, folder } = await launchDownloader({ launch, tempDir }, { format: "opus", playlistFolders: false });
  await expect.poll(() => invoke(page, "downloader", "state").catch(() => null)).toBeTruthy();
  await invoke(page, "downloader", "download", { videoId: "", playlistId: new URL(ALBUM_URL).searchParams.get("list")! }, "album");
  const state = () => invoke<{ active?: { stage: string; progress: number }; recent: { cancelled?: boolean }[] }>(page, "downloader", "state");
  await expect.poll(async () => (await state()).active?.progress ?? 0, { timeout: 60_000 }).toBeGreaterThan(0);
  await invoke(page, "downloader", "cancel");
  await expect.poll(async () => (await state()).recent[0]?.cancelled).toBe(true);
  expect(songFiles(folder).filter((file) => /\.(part|temp\.\w+|meta\.txt|cover\.jpg)$/.test(file))).toEqual([]);
});

test("downloader notifies when a download finishes while the window is hidden", async ({ launch, tempDir }) => {
  test.setTimeout(120_000);
  const { app, page } = await launchDownloader({ launch, tempDir }, { format: "opus" });
  await expect.poll(() => invoke(page, "downloader", "state").catch(() => null)).toBeTruthy();
  // Hidden once the app has shown it (it shows the window when the page is ready).
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((window) => window.isVisible()))).toBe(true);
  await app.evaluate(({ BrowserWindow, Notification }) => {
    const shown: string[] = [];
    Object.assign(globalThis, { shownNotifications: shown });
    Notification.prototype.show = function (this: Electron.Notification) {
      shown.push(this.body);
    };
    for (const window of BrowserWindow.getAllWindows()) window.hide();
  });
  await invoke(page, "downloader", "download", { videoId: TEST_TRACK }, "Test song");
  await expect
    .poll(() => app.evaluate(() => (globalThis as unknown as { shownNotifications: string[] }).shownNotifications), { timeout: 90_000 })
    .toEqual(["Saved “Test song”"]);
});

test("downloader adds Download to the menus of songs and albums, as pear-desktop", async ({ launch, tempDir }) => {
  test.setTimeout(150_000);
  const folder = tempDir("pear-downloads-");
  const page = await mainWindow(await launch({ plugins: { downloader: { enabled: true, config: { downloadFolder: folder } } } }));
  await page.goto(ALBUM_URL);
  const row = page.locator("#browse-page ytmusic-responsive-list-item-renderer").first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  // A track's menu, without playing it.
  await row.hover();
  // Its action menu (the last button: like and dislike come first).
  await row.locator("ytmusic-menu-renderer button").last().click();
  const item = page.locator("ytmusic-menu-popup-renderer .pear-dl-item");
  await expect(item).toBeVisible();
  await item.click();
  await expect(item).toBeHidden();
  await expect
    .poll(async () => ((await invoke(page, "downloader", "state")) as { active?: { label: string } }).active?.label, { timeout: 10_000 })
    .toMatch(/^[\w-]{11}$/);
  expect(await page.evaluate(() => window.__pearRuntime!.player.state.track)).toBeNull();
  await invoke(page, "downloader", "cancel");
});
