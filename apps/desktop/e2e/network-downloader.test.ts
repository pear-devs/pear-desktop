// downloader: a real download from the player-bar button (on either player bar)
// and from an album page's header with the built-in engine, with tags and cover
// art (native ffmpeg, and ffmpeg.wasm when there is none); the yt-dlp engine,
// downloading yt-dlp (and ffmpeg) when they aren't installed; the Downloads
// window, its queue, and its history across restarts.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { ytmUrl } from "@pear/sdk/util";
import type { Locator, Page } from "@playwright/test";
import { closeApp, expect, type Launch, test } from "./fixtures.ts";
import { pause } from "./helpers/playback.ts";
import { invoke, pluginError, pluginStatus, setConfig } from "./helpers/plugins.ts";
import { openSettings, pluginRow, searchbox } from "./helpers/settings.ts";
import { type LaunchOptions, mainWindow, playTestTrack, TEST_TRACK } from "./launch.ts";
import { barLayout, inBar, sel } from "./helpers/player-bar.ts";

// Rick Astley, "Whenever You Need Somebody": an album page that works logged out.
const ALBUM_URL = ytmUrl("/playlist?list=OLAK5uy_nmDUsWOMoEcz0SsVqUwir0oxu-k1oUyXE");
// The weekly global chart: a playlist page that works logged out.
const PLAYLIST_URL = ytmUrl("/playlist?list=PL4fGSI1pDJn6puJdseH2Rt9sMvt9E2M4i");
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

interface Job {
  id: number;
  label: string;
  status: "queued" | "active" | "done" | "failed" | "cancelled";
  progress: number;
  files: string[];
  engine?: string;
  items?: { status: string; downloaded?: number }[];
}
/** The downloads, running first, then queued, then finished (newest first). */
const jobs = (page: Page) => invoke<Job[]>(page, "downloader", "jobs");
const finishedJobs = async (page: Page) => (await jobs(page)).filter((job) => job.status !== "queued" && job.status !== "active");
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
async function launchDownloader(
  { launch, tempDir }: Setup,
  config: Record<string, unknown>,
  options: Pick<LaunchOptions, "env" | "core" | "userData"> = {},
) {
  const folder = tempDir("pear-downloads-");
  const app = await launch({
    ...options,
    plugins: {
      // Saving to the folder, as for everyone upgrading (new profiles keep songs in the app: see its own test).
      downloader: { enabled: true, config: { downloadFolder: folder, template: "%(title)s.%(ext)s", exportFiles: true, ...config } },
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

/** The Downloads entry in YTM's sidebar (the full one). */
const sidebarEntry = (page: Page) => page.locator("pear-downloader-entry").first().getByRole("button", { name: "Downloads" });
/** The Downloads popover, which hovering the sidebar entry shows. */
const popover = (page: Page) => page.locator(".pear-dl-downloads-popover");
/**
 * Shows the popover, keeping the pointer on the entry; again if YTM redrew the
 * sidebar under the pointer while the page was loading.
 */
async function preview(page: Page) {
  await expect(async () => {
    await page.mouse.move(900, 600);
    await sidebarEntry(page).hover();
    await expect(popover(page)).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });
}
/** The queue strip on the Downloads page. */
const queue = (page: Page) => page.locator(".pear-dl-section");
/** Opens the strip to its rows, if it isn't. */
async function openQueue(page: Page) {
  const chevron = queue(page).locator(".strip .chevron");
  if ((await chevron.getAttribute("aria-expanded")) !== "true") await chevron.click();
  await expect(chevron).toHaveAttribute("aria-expanded", "true");
}
/** Opens the strip's finished downloads. */
async function showFinished(page: Page) {
  await openQueue(page);
  await queue(page).locator(".finished-row").getByRole("button", { name: "Show", exact: true }).click();
}
/** Opens YTM's Home, as its own links do (YTM doesn't follow `history.pushState`). */
async function goHome(page: Page) {
  await page.evaluate(() => {
    const detail = { endpoint: { browseEndpoint: { browseId: "FEmusic_home" } } };
    document.querySelector("ytmusic-app")!.dispatchEvent(new CustomEvent("yt-navigate", { bubbles: true, composed: true, detail }));
  });
  await expect(page).not.toHaveURL(/FEmusic_offline/);
}
/** The Downloads page shows, with our entry as the highlighted one. */
async function expectDownloadsPage(page: Page) {
  await expect(page).toHaveURL(/\/browse\/FEmusic_offline/);
  await expect(sidebarEntry(page)).toHaveAttribute("aria-current", "page");
}
/** A song or download still to go, in the strip. */
const row = (page: Page, label: string | RegExp) => queue(page).locator("li.row:not(.history, .finished-row)", { has: page.locator(".row-title", { hasText: label }) });
/** The song or download rows still to go. */
const rows = (page: Page) => queue(page).locator("li.row:not(.history, .finished-row)");
/** A finished download, in the strip once its finished ones show. */
const finishedRow = (page: Page, label: string | RegExp) => queue(page).locator("li.history", { has: page.locator(".row-title", { hasText: label }) });
/** A row's button. */
const action = (row: Locator, name: string) => row.getByRole("button", { name, exact: true });
/** A button of the strip itself. */
const stripButton = (page: Page, name: string) => queue(page).locator(".strip").getByRole("button", { name, exact: true });
/** What `size · when` reads for a finished download. */
const FINISHED_LINE = /^[\d.]+ [KMG]iB · /;

test("downloader saves the current song as a tagged mp3 from the player bar", async ({ launch, tempDir }) => {
  test.skip(!hasTool("yt-dlp") || !hasTool("ffmpeg"), "needs yt-dlp and ffmpeg");
  test.setTimeout(150_000);
  const { page, folder } = await launchDownloader({ launch, tempDir }, { format: "mp3", lyrics: true, lyricsFile: true });
  await expect
    .poll(() => invoke<{ capabilities: { ffmpeg: boolean } }>(page, "downloader", "info").catch(() => null))
    .toMatchObject({ capabilities: { ffmpeg: true } });

  const { button, toast } = await downloadButton(page);
  await expect(button).toHaveAttribute("aria-label", "Download");
  await button.click();

  // Progress shows on the button, then a toast confirms.
  await expect(button).toHaveAttribute("data-busy", /downloading|converting/, { timeout: 30_000 });
  await expect(toast).toContainText("Saved", { timeout: 90_000 });
  await expect(toast.getByRole("button", { name: "Show" })).toBeVisible();
  await expect(button).not.toHaveAttribute("data-busy");
  expect((await jobs(page))[0]).toMatchObject({ status: "done", engine: "built-in" });

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
  await expect.poll(async () => (await finishedJobs(page)).length).toBe(2);
  expect(songFiles(folder).sort()).toEqual([expect.stringMatching(/\.lrc$/), "renamed.mp3"]);

  // A missing yt-dlp is reported in settings.
  await setConfig(page, "downloader", { ytDlpPath: "/nonexistent/yt-dlp" });
  await expect.poll(() => pluginError(page, "downloader")).toMatch(/yt-dlp was not found/);
});

for (const layout of ["classic", "new"] as const) {
  test(`downloader's button on the ${layout} player bar downloads the playing song, and Ctrl+J opens the Downloads page`, async ({
    launch,
    tempDir,
  }) => {
    test.setTimeout(150_000);
    const { app, page } = await launchDownloader({ launch, tempDir }, { format: "opus" }, { core: { site: { playerBar: layout } } });
    const { button, toast } = await downloadButton(page);
    expect(await barLayout(page)).toBe(layout);

    // A click downloads the song straight away.
    const title = await page.evaluate(() => window.__pearRuntime!.player.state.track!.title);
    await button.click();
    await expect.poll(() => jobs(page)).toEqual([expect.objectContaining({ label: title })]);
    await expect(toast).toContainText("Saved", { timeout: 90_000 });

    // The popover sums it up; "View all" opens the Downloads page with the queue open.
    await preview(page);
    await expect(popover(page).locator(".summary-phase")).toHaveText("All downloads finished");
    await expect(popover(page).locator(".summary-count")).toHaveText(title);
    await expect(popover(page).locator(".summary-percent")).toHaveText("100%");
    await popover(page).getByRole("button", { name: "View all" }).click();
    await expectDownloadsPage(page);
    await expect(popover(page)).toBeHidden();
    await expect(queue(page).locator(".strip-title")).toHaveText("All downloads finished");
    await expect(queue(page).locator(".strip-sub")).toHaveText("1 song saved");
    await showFinished(page);
    await expect(finishedRow(page, title).locator(".row-sub")).toHaveText(FINISHED_LINE);
    await expect(action(finishedRow(page, title), "Show in folder")).toBeVisible();
    // Dismissed, the strip stays away until something else finishes.
    await stripButton(page, "Dismiss").click();
    await expect(queue(page)).toBeHidden();
    await goHome(page);
    await page.keyboard.press("Control+j");
    await expectDownloadsPage(page);
    await expect(queue(page)).toBeHidden();
  });
}

test("downloader keeps songs in the app unless asked, and saves them to the folder from their row", async ({ launch, tempDir }) => {
  test.setTimeout(150_000);
  const { page, folder } = await launchDownloader({ launch, tempDir }, { format: "opus", exportFiles: false });
  await expect.poll(() => invoke(page, "downloader", "state").catch(() => null)).toBeTruthy();
  await invoke(page, "downloader", "download", { videoId: TEST_TRACK }, "Test song");
  await expect.poll(async () => (await jobs(page))[0]?.status, { timeout: 90_000 }).toBe("done");

  // Kept in the app: nothing in the folder, and the song is in the downloader's store.
  expect(songFiles(folder)).toEqual([]);
  expect(await jobs(page)).toEqual([expect.objectContaining({ files: [], kept: [TEST_TRACK] })]);
  const tracks = await invoke<{ videoId: string }[]>(page, "downloader", "offlineTracks");
  expect(tracks.map((track) => track.videoId)).toEqual([TEST_TRACK]);

  // Its row says so, and saves it to the folder, converted as the settings say then.
  await page.keyboard.press("Control+j");
  await expectDownloadsPage(page);
  // The site's page lists it too, signed out as well (the site loads its offline database only for accounts).
  await expect(page.locator("ytmusic-offline-item-section-renderer").getByText("Downloaded songs")).toBeVisible();
  await showFinished(page);
  const song = finishedRow(page, "Test song");
  await expect(song.locator(".row-sub")).toContainText("In the app");
  await action(song, "Save to the download folder").click();
  await expect.poll(() => songFiles(folder), { timeout: 60_000 }).toEqual(["Never Gonna Give You Up.opus"]);
  const tags = ffprobe<{ format: { tags?: Record<string, string> }; streams: { codec_type: string; tags?: Record<string, string> }[] }>(
    join(folder, "Never Gonna Give You Up.opus"),
    "-show_streams",
  );
  expect(tags.streams.find((stream) => stream.codec_type === "audio")?.tags).toMatchObject({ title: "Never Gonna Give You Up", artist: "Rick Astley" });
  await expect(action(song, "Show in folder")).toBeVisible();
  await expect(song.locator(".row-sub")).not.toContainText("In the app");
});

test("downloader downloads yt-dlp when it isn't installed, and says so when offline", async ({ launch, tempDir }) => {
  test.setTimeout(240_000);
  const ffmpeg = whichTool("ffmpeg");
  test.skip(!ffmpeg || !hasTool("ffprobe"), "needs ffmpeg (only yt-dlp is downloaded here)");
  const { app, page, folder } = await launchDownloader(
    { launch, tempDir },
    { engine: "yt-dlp", format: "opus", ffmpegPath: dirname(ffmpeg!) },
    { env: NO_SYSTEM_TOOLS },
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
    // The failed download is in the list, to try again.
    const [failed] = await jobs(page);
    expect(failed).toMatchObject({ status: "failed" });
    await invoke(page, "downloader", "retry", failed!.id);
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
  const { app, page, folder } = await launchDownloader({ launch, tempDir }, { engine: "yt-dlp", format: "mp3" }, { env: NO_SYSTEM_TOOLS });
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
  const { app, page, folder } = await launchDownloader({ launch, tempDir }, { format: "mp3", replayGain: true }, { env: NO_SYSTEM_TOOLS });
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

test("downloader saves an album from its page's Download button, with the album's tags, and remembers it after a restart", async ({
  launch,
  tempDir,
}) => {
  test.skip(!hasTool("ffmpeg") || !hasTool("ffprobe"), "needs ffmpeg");
  test.setTimeout(180_000);
  const userData = tempDir("pear-profile-");
  const config = { format: "opus", playlistMaxItems: 2, replayGain: true };
  const { app, page, folder } = await launchDownloader({ launch, tempDir }, config, { userData });
  await page.goto(ALBUM_URL);
  const pageButton = page.locator(".pear-dl-page-button");
  await expect(pageButton).toBeVisible({ timeout: 30_000 });
  await expect(pageButton).toHaveAttribute("aria-label", "Download album");
  await pageButton.click();
  await expect
    .poll(() => jobs(page), { timeout: 120_000 })
    .toEqual([
      expect.objectContaining({ label: "Whenever You Need Somebody", status: "done", engine: "built-in", files: [expect.any(String), expect.any(String)] }),
    ]);
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
  // Kept for offline playback as well: the album, with its two songs.
  const lists = await invoke<{ playlistId: string; videoIds: string[] }[]>(page, "downloader", "offlineLists");
  expect(lists).toEqual([expect.objectContaining({ playlistId: new URL(ALBUM_URL).searchParams.get("list"), videoIds: [expect.any(String), expect.any(String)] })]);

  // The popover sums it up, its two songs done, and still does after a restart.
  await preview(page);
  await expect(popover(page).locator(".summary-count")).toHaveText("2 of 2");
  await expect(popover(page).locator(".summary-name")).toHaveText("Whenever You Need Somebody");
  await closeApp(app);
  const again = await launchDownloader({ launch, tempDir }, config, { userData });
  await preview(again.page);
  await expect(popover(again.page).locator(".summary-count")).toHaveText("2 of 2");
  await popover(again.page).getByRole("button", { name: "View all" }).click();
  await showFinished(again.page);
  await expect(finishedRow(again.page, "Whenever You Need Somebody").locator(".row-sub")).toHaveText(FINISHED_LINE);

  // A playlist's page has the button too.
  await again.page.goto(PLAYLIST_URL);
  const listButton = again.page.locator(".pear-dl-page-button");
  await expect(listButton).toHaveAttribute("aria-label", "Download playlist", { timeout: 30_000 });
  // YTM moves between pages with pushState and may keep the header: the button follows the URL.
  const pushUrl = (url: string) => again.page.evaluate((url) => history.pushState({}, "", url), url);
  await pushUrl("/explore");
  await expect(listButton).toBeHidden();
  await pushUrl(ALBUM_URL);
  await expect(listButton).toHaveAttribute("aria-label", "Download album");
});

test("downloader cancels and retries from the Downloads page's queue, leaving nothing half-written, and the popover sums it up", async ({
  launch,
  tempDir,
}) => {
  test.setTimeout(120_000);
  const { app, page, folder } = await launchDownloader({ launch, tempDir }, { format: "opus", playlistFolders: false });
  await expect.poll(() => invoke(page, "downloader", "state").catch(() => null)).toBeTruthy();
  // Downloads is in the app menu too, under Options, with Ctrl+J.
  const options = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items[0]!.submenu!.items.map((item) => `${item.label} ${item.accelerator ?? ""}`));
  expect(options).toContain("Downloads CmdOrCtrl+J");
  await preview(page);
  await expect(popover(page).locator(".summary-phase")).toHaveText("Nothing downloaded yet");

  // The queue stays while the album downloads, wherever the pointer is.
  await sidebarEntry(page).click();
  await expectDownloadsPage(page);
  await invoke(page, "downloader", "download", { videoId: "", playlistId: new URL(ALBUM_URL).searchParams.get("list")! }, "album");
  await expect.poll(async () => (await jobs(page))[0]?.progress ?? 0, { timeout: 60_000 }).toBeGreaterThan(0);
  // The sidebar entry counts the running download.
  await expect(page.locator("pear-downloader-entry").first().locator(".badge")).toHaveText("1");
  await expect(queue(page).locator(".strip-title")).toHaveText(/^Downloading album/);
  await expect(queue(page).locator(".strip-sub")).toHaveText(/left|\/s|Starting|Converting/);
  await openQueue(page);
  // Its songs, one downloading with its progress.
  await expect(rows(page)).toHaveCount(2);
  await expect(queue(page).locator(".row-progress").first()).toBeVisible();

  await stripButton(page, "Cancel").click();
  const album = row(page, "album");
  await expect(album.locator(".row-state")).toHaveText("Cancelled");
  await expect(queue(page).locator(".strip-title")).toHaveText("Download cancelled");
  expect(songFiles(folder).filter((file) => /\.(part|temp\.\w+|meta\.txt|cover\.jpg)$/.test(file))).toEqual([]);

  // Retry downloads it again, and the popover says so.
  await action(album, "Retry").click();
  await expect(queue(page).locator(".strip-title")).toHaveText(/^(Downloading album|Waiting · album)/);
  await goHome(page);
  await preview(page);
  await expect(popover(page).locator(".summary-phase")).toHaveText(/Downloading|Waiting/);
  await expect(popover(page).locator(".summary-percent")).toHaveText(/^\d+%$/);
  await invoke(page, "downloader", "cancel");
  await expect.poll(async () => (await jobs(page))[0]?.status).toBe("cancelled");
  await expect(popover(page).locator(".summary-phase")).toHaveText("Download cancelled");
});

test("downloader pauses a playlist, keeping its parts, and resumes it without downloading the saved songs again", async ({ launch, tempDir }) => {
  test.setTimeout(180_000);
  const { app, page, folder } = await launchDownloader({ launch, tempDir }, { format: "opus", playlistFolders: false, playlistMaxItems: 4 });
  await expect.poll(() => invoke(page, "downloader", "state").catch(() => null)).toBeTruthy();
  // The Downloads page's queue shows it while it isn't done.
  await sidebarEntry(page).click();
  await expectDownloadsPage(page);
  await invoke(page, "downloader", "download", { videoId: "", playlistId: new URL(ALBUM_URL).searchParams.get("list")! }, "album");
  // While running, its songs show; pause once one is saved and another is under way.
  await openQueue(page);
  await expect.poll(async () => (await jobs(page))[0]?.items?.length ?? 0, { timeout: 60_000 }).toBe(4);
  const started = async () => {
    const [job] = await jobs(page);
    const items = job?.items ?? [];
    return items.some((item) => item.status === "done") && items.some((item) => item.status === "active" && (item.downloaded ?? 0) > 0);
  };
  await expect.poll(started, { timeout: 60_000, intervals: [50] }).toBe(true);
  await stripButton(page, "Pause").click();
  await expect(queue(page).locator(".strip-title")).toHaveText(/^Paused · album/);
  await expect(rows(page).first().locator(".row-state")).toHaveText("Paused");
  const parts = () => songFiles(folder).filter((file) => file.endsWith(".part"));
  expect(parts().length).toBeGreaterThan(0);
  const saved = songFiles(folder).filter((file) => file.endsWith(".opus"));
  expect(saved.length).toBeGreaterThan(0);
  const savedAt = saved.map((file) => statSync(join(folder, file)).mtimeMs);

  await stripButton(page, "Resume").click();
  await expect.poll(async () => (await jobs(page))[0]?.status, { timeout: 120_000 }).toBe("done");
  await expect(queue(page).locator(".strip-title")).toHaveText("All downloads finished");
  await expect(rows(page)).toHaveCount(0);
  expect(parts()).toEqual([]);
  expect(songFiles(folder).filter((file) => file.endsWith(".opus"))).toHaveLength(4);
  // The songs saved before the pause weren't written again.
  expect(saved.map((file) => statSync(join(folder, file)).mtimeMs)).toEqual(savedAt);
  expect((await jobs(page))[0]!.files).toHaveLength(4);
});

test("downloader's Downloads page: opened by its sidebar entry, Ctrl+J and the menus, with the queue on top", async ({ launch, tempDir }) => {
  test.setTimeout(120_000);
  const { app, page } = await launchDownloader({ launch, tempDir }, { format: "opus" });
  const entry = page.locator("pear-downloader-entry").first();
  await expect(entry).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => invoke(page, "downloader", "state").catch(() => null)).toBeTruthy();

  // Hovering previews the downloads; moving away closes the preview.
  await entry.hover();
  await expect(popover(page)).toBeVisible();
  await expect(popover(page)).toHaveAttribute("data-side", "right");
  await page.mouse.move(900, 600);
  await expect(popover(page)).toBeHidden();

  // A click opens the site's Downloads page as ours: no Library tab bar, and no preview there.
  await sidebarEntry(page).click();
  await expectDownloadsPage(page);
  await expect(page.locator(sel("browse.tabs"))).toBeHidden();
  await entry.hover();
  await page.waitForTimeout(600);
  await expect(popover(page)).toBeHidden();

  // Elsewhere the entry is no longer highlighted; the app menu and Ctrl+J open the page again.
  await goHome(page);
  await expect(sidebarEntry(page)).not.toHaveAttribute("aria-current", "page");
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items[0]!.submenu!.items.find((item) => item.label === "Downloads")!.click());
  await expectDownloadsPage(page);
  await goHome(page);
  await page.keyboard.press("Control+j");
  await expectDownloadsPage(page);

  // The queue shows what isn't done, above the page's songs.
  await expect(queue(page)).toBeHidden();
  const id = await invoke<number>(page, "downloader", "download", { videoId: TEST_TRACK }, "Test song");
  await invoke(page, "downloader", "pause", id);
  await expect(queue(page).getByRole("region", { name: "Download queue" })).toBeVisible();
  await expect(queue(page).locator(".strip-title")).toHaveText("Paused · Test song");
  await openQueue(page);
  const queued = row(page, "Test song");
  await expect(queued.locator(".row-state")).toHaveText("Paused");
  await action(queued, "Cancel").click();
  await expect(queued.locator(".row-state")).toHaveText("Cancelled");
  await action(queued, "Remove").click();
  await expect(queue(page)).toBeHidden();
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
