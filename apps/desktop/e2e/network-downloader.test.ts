// downloader: a real download from the player-bar button with the built-in
// engine, with tags and cover art (native ffmpeg, and ffmpeg.wasm when there is
// none); the yt-dlp engine, downloading yt-dlp (and ffmpeg) when they aren't installed.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ytmUrl } from "@pear/sdk/util";
import type { Page } from "@playwright/test";
import { expect, type Launch, test } from "./fixtures.ts";
import { pause } from "./helpers/playback.ts";
import { invoke, pluginError, pluginStatus, setConfig } from "./helpers/plugins.ts";
import { openSettings, pluginRow, searchbox } from "./helpers/settings.ts";
import { mainWindow, playTestTrack } from "./launch.ts";

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
  const button = page.locator("ytmusic-player-bar .pear-dl-button");
  await expect(button).toBeVisible({ timeout: 15_000 });
  return { button, toast: page.locator(".pear-dl-toast") };
}

test("downloader saves the current song as a tagged mp3 from the player bar", async ({ launch, tempDir }) => {
  test.skip(!hasTool("yt-dlp") || !hasTool("ffmpeg"), "needs yt-dlp and ffmpeg");
  test.setTimeout(150_000);
  const { page, folder } = await launchDownloader({ launch, tempDir }, { format: "mp3" });
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

  expect(await status(page)).toBe(
    "Downloading with the built-in downloader, converting with ffmpeg (installed on this computer); yt-dlp (installed on this computer) takes over when that fails.",
  );

  const files = readdirSync(folder);
  expect(files).toHaveLength(1);
  expect(files[0]).toMatch(/\.mp3$/);
  const tags = ffprobe<{ format: { tags: Record<string, string> }; streams: { codec_type: string; width?: number; height?: number }[] }>(
    join(folder, files[0]!),
    "-show_format",
    "-show_streams",
  );
  const title = await page.evaluate(() => window.__pearRuntime!.player.state.track!.title);
  expect(tags.format.tags.title).toContain(title);
  expect(tags.format.tags.artist).toBeTruthy();
  const cover = tags.streams.find((s) => s.codec_type === "video");
  expect(cover).toBeTruthy();
  expect(cover!.width).toBe(cover!.height);

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
    await button.click();
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

  const files = readdirSync(folder);
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
  expect(readdirSync(folder)).toEqual([expect.stringMatching(/\.mp3$/)]);
});

test("downloader converts with ffmpeg.wasm when there is no ffmpeg, without downloading anything", async ({ launch, tempDir }) => {
  test.skip(!hasTool("ffprobe"), "needs ffprobe to check the file");
  test.setTimeout(150_000);
  const { app, page, folder } = await launchDownloader({ launch, tempDir }, { format: "mp3" }, NO_SYSTEM_TOOLS);
  await expect.poll(() => status(page), { timeout: 20_000 }).toBe(
    "Downloading with the built-in downloader, converting with the built-in ffmpeg; yt-dlp is downloaded when that fails.",
  );
  const { button, toast } = await downloadButton(page);
  await button.click();
  await expect(toast).toContainText("Saved", { timeout: 120_000 });
  // Neither yt-dlp nor ffmpeg was needed.
  expect(existsSync(join(app.userData, "bin"))).toBe(false);
  const files = readdirSync(folder);
  expect(files).toEqual([expect.stringMatching(/\.mp3$/)]);
  const { format, streams } = ffprobe<{ format: { tags: Record<string, string> }; streams: { codec_type: string; width?: number; height?: number }[] }>(
    join(folder, files[0]!),
    "-show_format",
    "-show_streams",
  );
  expect(format.tags.title).toBeTruthy();
  expect(format.tags.artist).toBeTruthy();
  // node-id3 wrote the cover, square.
  const cover = streams.find((s) => s.codec_type === "video");
  expect(cover?.width).toBe(cover?.height);
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
