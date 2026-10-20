// downloader: a real yt-dlp download from the player-bar button, with tags and
// cover art; and downloading yt-dlp (and ffmpeg) when they aren't installed.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { launchApp, mainWindow, playTestTrack } from "./launch.ts";
import { closeApp, invoke } from "./network-helpers.ts";

const whichTool = (name: string) => {
  try {
    return execFileSync(process.platform === "win32" ? "where" : "which", [name], { encoding: "utf8" }).split(/\r?\n/)[0]!.trim();
  } catch {
    return undefined;
  }
};
const hasTool = (name: string) => !!whichTool(name);
/** Makes the plugin act as if neither is installed (see plugins/downloader/index.ts). */
const NO_SYSTEM_TOOLS = { PEAR_DOWNLOADER_IGNORE_SYSTEM_TOOLS: "1" };

const status = (page: Page) => page.evaluate(() => window.__pearRuntime!.plugins.status("downloader") ?? "");

test("downloader saves the current song as a tagged mp3 from the player bar", async () => {
  test.skip(!hasTool("yt-dlp") || !hasTool("ffmpeg"), "needs yt-dlp and ffmpeg");
  test.setTimeout(150_000);
  const folder = mkdtempSync(join(tmpdir(), "pear-downloads-"));
  const app = await launchApp({
    plugins: {
      downloader: { enabled: true, config: { downloadFolder: folder, format: "mp3", template: "%(title)s.%(ext)s" } },
      "do-not-track": { enabled: true },
    },
  });
  let page: Page | undefined;
  try {
    page = await mainWindow(app);
    await expect
      .poll(() => invoke<{ capabilities: { ffmpeg: boolean } }>(page!, "downloader", "info").catch(() => null))
      .toMatchObject({ capabilities: { ffmpeg: true } });

    await playTestTrack(page);
    await page.evaluate(() => window.__pearRuntime!.player.control({ type: "pause" }));

    const button = page.locator("ytmusic-player-bar .pear-dl-button");
    await expect(button).toBeVisible({ timeout: 15_000 });
    await expect(button).toHaveAttribute("title", "Download");
    await button.click();

    // Progress shows on the button, then a toast confirms.
    await expect(button).toHaveAttribute("data-busy", /downloading|converting/, { timeout: 30_000 });
    const toast = page.locator(".pear-dl-toast");
    await expect(toast).toContainText("Saved", { timeout: 90_000 });
    await expect(toast.getByRole("button", { name: "Show" })).toBeVisible();
    await expect(button).not.toHaveAttribute("data-busy");

    expect(await status(page)).toMatch(/^Using yt-dlp \S+ \(installed on this computer\) and ffmpeg \(installed on this computer\)\.$/);

    const files = readdirSync(folder);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.mp3$/);
    const tags = JSON.parse(
      execFileSync("ffprobe", ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", join(folder, files[0]!)], {
        encoding: "utf8",
      }),
    ) as { format: { tags: Record<string, string> }; streams: { codec_type: string; width?: number; height?: number }[] };
    const title = await page.evaluate(() => window.__pearRuntime!.player.state.track!.title);
    expect(tags.format.tags.title).toContain(title);
    expect(tags.format.tags.artist).toBeTruthy();
    const cover = tags.streams.find((s) => s.codec_type === "video");
    expect(cover).toBeTruthy();
    expect(cover!.width).toBe(cover!.height);

    // A missing yt-dlp is reported in settings.
    await page.evaluate(() => window.__pear!.invoke("plugin:set-config", "downloader", { ytDlpPath: "/nonexistent/yt-dlp" }));
    await expect
      .poll(() => page!.evaluate(() => window.__pearRuntime!.plugins.error("downloader") ?? ""))
      .toMatch(/yt-dlp was not found/);
  } finally {
    await closeApp(app, page);
    rmSync(folder, { recursive: true, force: true });
  }
});

test("downloader downloads yt-dlp when it isn't installed, and says so when offline", async () => {
  test.setTimeout(240_000);
  const ffmpeg = whichTool("ffmpeg");
  test.skip(!ffmpeg || !hasTool("ffprobe"), "needs ffmpeg (only yt-dlp is downloaded here)");
  const folder = mkdtempSync(join(tmpdir(), "pear-downloads-"));
  const app = await launchApp({
    env: NO_SYSTEM_TOOLS,
    plugins: {
      downloader: { enabled: true, config: { downloadFolder: folder, format: "opus", template: "%(title)s.%(ext)s", ffmpegPath: dirname(ffmpeg!) } },
      "do-not-track": { enabled: true },
    },
  });
  let page: Page | undefined;
  try {
    page = await mainWindow(app);
    await expect.poll(() => status(page!), { timeout: 20_000 }).toBe(
      "yt-dlp isn't installed; it will be downloaded the first time you download a song.",
    );
    await playTestTrack(page);
    await page.evaluate(() => window.__pearRuntime!.player.control({ type: "pause" }));
    const button = page.locator("ytmusic-player-bar .pear-dl-button");
    const toast = page.locator(".pear-dl-toast");
    await expect(button).toBeVisible({ timeout: 15_000 });

    // Offline (a proxy nobody listens on): a clear message, and nothing left behind.
    await app.evaluate(({ session }) => session.defaultSession.setProxy({ proxyRules: "http://127.0.0.1:9" }));
    await button.click();
    await expect(toast).toContainText("Download failed: Couldn't download yt-dlp", { timeout: 20_000 });
    await expect(toast).toContainText("Check your internet connection and try again.");
    await expect.poll(() => status(page!)).toMatch(/^Couldn't download yt-dlp .*internet connection/);
    expect(existsSync(join(app.userData, "bin", "yt-dlp"))).toBe(false);
    await app.evaluate(({ session }) => session.defaultSession.setProxy({ mode: "direct" }));

    // Online: yt-dlp is downloaded (with progress on the button), then the song.
    await button.click();
    await expect(toast).toContainText("Downloading yt-dlp, which saving songs needs", { timeout: 20_000 });
    await expect(button).toHaveAttribute("title", /^(Downloading|Checking) yt-dlp/);
    await expect.poll(() => status(page!), { timeout: 20_000 }).toMatch(/^(Downloading yt-dlp… \d+%|Checking yt-dlp…)$/);
    await expect(toast).toContainText("Saved", { timeout: 180_000 });
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
    await page.keyboard.press("Control+,");
    await page.locator("pear-settings").getByRole("searchbox").fill("downloader");
    await expect(page.locator('pear-settings [data-plugin="downloader"] .status-text')).toContainText("yt-dlp", { timeout: 10_000 });
    await expect(page.locator('pear-settings [data-plugin="downloader"] .status-text')).toContainText("(downloaded automatically)");
    await page.keyboard.press("Escape");

    const files = readdirSync(folder);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.opus$/);
    const streams = JSON.parse(
      execFileSync("ffprobe", ["-v", "quiet", "-print_format", "json", "-show_streams", join(folder, files[0]!)], { encoding: "utf8" }),
    ) as { streams: { codec_type: string }[] };
    expect(streams.streams.some((s) => s.codec_type === "video")).toBe(true);
  } finally {
    await closeApp(app, page);
    rmSync(folder, { recursive: true, force: true });
  }
});

// Downloads ffmpeg too (60-160 MB, depending on the platform), so only on request.
test("downloader downloads yt-dlp and ffmpeg when neither is installed", async () => {
  test.skip(process.env.PEAR_E2E_FFMPEG_DOWNLOAD !== "1", "set PEAR_E2E_FFMPEG_DOWNLOAD=1 to download ffmpeg");
  test.setTimeout(600_000);
  const folder = mkdtempSync(join(tmpdir(), "pear-downloads-"));
  const app = await launchApp({
    env: NO_SYSTEM_TOOLS,
    plugins: {
      downloader: { enabled: true, config: { downloadFolder: folder, format: "mp3", template: "%(title)s.%(ext)s" } },
      "do-not-track": { enabled: true },
    },
  });
  let page: Page | undefined;
  try {
    page = await mainWindow(app);
    await expect.poll(() => status(page!), { timeout: 20_000 }).toBe(
      "yt-dlp and ffmpeg aren't installed; they will be downloaded the first time you download a song.",
    );
    await playTestTrack(page);
    await page.evaluate(() => window.__pearRuntime!.player.control({ type: "pause" }));
    const button = page.locator("ytmusic-player-bar .pear-dl-button");
    await expect(button).toBeVisible({ timeout: 15_000 });
    await button.click();
    const toast = page.locator(".pear-dl-toast");
    await expect(toast).toContainText("Downloading ffmpeg", { timeout: 120_000 });
    await expect(toast).toContainText("Saved", { timeout: 540_000 });
    const info = await invoke<{ sources: unknown; ffmpeg: string }>(page, "downloader", "info");
    expect(info.sources).toEqual({ ytDlp: "managed", ffmpeg: "managed" });
    expect(info.ffmpeg).toBe(join(app.userData, "bin", "ffmpeg"));
    expect(readdirSync(folder)).toEqual([expect.stringMatching(/\.mp3$/)]);
  } finally {
    await closeApp(app, page);
    rmSync(folder, { recursive: true, force: true });
  }
});

test("downloader adds Download to the menus of songs and albums, as pear-desktop", async () => {
  test.setTimeout(150_000);
  const folder = mkdtempSync(join(tmpdir(), "pear-downloads-"));
  const app = await launchApp({ plugins: { downloader: { enabled: true, config: { downloadFolder: folder } } } });
  let page: Page | undefined;
  try {
    page = await mainWindow(app);
    await page.goto("https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/playlist?list=OLAK5uy_nmDUsWOMoEcz0SsVqUwir0oxu-k1oUyXE");
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
      .poll(async () => ((await invoke(page!, "downloader", "state")) as { active?: { label: string } }).active?.label, { timeout: 10_000 })
      .toMatch(/^[\w-]{11}$/);
    expect(await page.evaluate(() => window.__pearRuntime!.player.state.track)).toBeNull();
    await invoke(page, "downloader", "cancel");
  } finally {
    await closeApp(app, page);
    rmSync(folder, { recursive: true, force: true });
  }
});
