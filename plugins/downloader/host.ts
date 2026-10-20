// The host part: finding or installing the tools, the download queue, and telling
// the page and the settings how it is going.

import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type HostContextOf, livePosition, type NowPlaying, type Track } from "@pear/sdk";
import { YTM_ORIGIN } from "@pear/sdk/util";
import { Notification, nativeImage, net } from "electron";
import { archivePath } from "./archive.ts";
import type { downloaderConfig } from "./config.ts";
import { chooseConverter, type Converter, type Cover, WasmConverter, type WasmFFmpeg } from "./convert.ts";
import { isSiteCookie, toNetscape } from "./cookies.ts";
import { DownloadQueue, type JobResult, type QueueState } from "./downloads.ts";
import { type BuiltInJobOptions, InnertubeEngine, InnertubeSession, type PoTokenAnswer } from "./engines/innertube.ts";
import type { Engine } from "./engines/types.ts";
import { YtDlpEngine } from "./engines/ytdlp.ts";
import { Installer } from "./install.ts";
import { findLyrics } from "./lyrics.ts";
import { ffmpegCoreDir } from "./macros.ts" with { type: "macro" };
import type { PoTokenRequest } from "./potoken.ts";
import { expandHome, type SetupState, type ToolSource, Tools } from "./tools.ts";
import { type Capabilities, canEmbedCover } from "./ytdlp.ts";

export type Ctx = HostContextOf<typeof downloaderConfig>;
type Config = Ctx["config"];

/** What the page shows: the queue, and yt-dlp or ffmpeg being downloaded. */
export interface DownloaderState extends QueueState {
  setup?: SetupState | undefined;
  /** The last downloads, newest first. */
  recent?: JobResult[];
}

interface Downloader {
  queue: DownloadQueue;
  tools: Tools;
  recent: JobResult[];
}

/** Tests set this to pretend yt-dlp and ffmpeg aren't installed. */
const IGNORE_SYSTEM_TOOLS = "PEAR_DOWNLOADER_IGNORE_SYSTEM_TOOLS";
/** Checking for a newer yt-dlp waits a little after startup. */
const UPDATE_DELAY_MS = 15_000;
/** After a failed download, a newer yt-dlp may fix it; check if the last check is this old. */
const UPDATE_AFTER_FAILURE_MS = 60 * 60 * 1000;
/** How many finished downloads the button's menu lists. */
const RECENT_COUNT = 10;
/** Progress comes per network chunk; the page and the settings need a few updates a second. */
const PUBLISH_INTERVAL_MS = 250;
/** BotGuard takes a few seconds in the page; a page that is loading takes longer to answer. */
const PO_TOKEN_TIMEOUT_MS = 60_000;
/** The cover's JPEG quality. */
const COVER_QUALITY = 92;
/** The taskbar shows at least a sliver while a download runs. */
const MIN_TASKBAR_PROGRESS = 0.01;
/** `setProgressBar` value that removes the bar. */
const NO_TASKBAR_PROGRESS = -1;

// Per running host instance (commands get the same ctx as `start`).
const downloaders = new WeakMap<object, Downloader>();

export function downloaderOf(ctx: Pick<Ctx, "t">) {
  const downloader = downloaders.get(ctx);
  if (!downloader) throw new Error(ctx.t("plugins.downloader.errors.starting", "the downloader is still starting"));
  return downloader;
}

export function stateOf({ queue, tools, recent }: Downloader): DownloaderState {
  return { ...queue.state, setup: tools.setup, recent };
}

export async function startHost(ctx: Ctx) {
  const tools = createTools(ctx, () => publisher.publish());
  const publisher = new Publisher(ctx, tools);
  await tools.init();

  const autoJobs = new Set<number>();
  const recent: JobResult[] = [];
  const remember = (result: JobResult) => {
    recent.unshift(result);
    recent.splice(RECENT_COUNT);
  };
  const queue = createQueue(ctx, tools, autoJobs, remember, () => publisher.publish());
  downloaders.set(ctx, { queue, tools, recent });
  // Everything but the tool paths is read per download.
  const toolsKey = toolsKeyOf(ctx.config);
  ctx.onConfigChange((config) => {
    if (toolsKeyOf(config) !== toolsKey) return "restart";
    // The status line names the engine.
    publisher.flush();
  });
  ctx.setTimeout(() => void tools.update(), UPDATE_DELAY_MS);
  ctx.onCleanup(() => {
    queue.dispose();
    downloaders.delete(ctx);
  });
  publisher.flush();
  if (tools.ytDlp) ctx.log.info(`yt-dlp ${tools.capabilities?.version ?? ""} at ${tools.ytDlp.path}`);

  downloadWhileListening(ctx, (track) => autoJobs.add(queue.add({ videoId: track.videoId }, track.title)));
}

// ---------------------------------------------------------------- tools

/** yt-dlp and ffmpeg; programs missing from the computer are downloaded when first needed. */
function createTools(ctx: Ctx, onChange: () => void) {
  const installer = new Installer({
    dir: join(ctx.app.getPath("userData"), "bin"),
    fetch: (url, init) => ctx.session.fetch(url, init),
    resolveRedirect,
    onProgress: (progress) => tools.progress(progress),
  });
  const tools: Tools = new Tools({
    ytDlpPath: ctx.config.ytDlpPath,
    ffmpegPath: ctx.config.ffmpegPath,
    installer,
    systemTools: process.env[IGNORE_SYSTEM_TOOLS] !== "1",
    t: ctx.t,
    log: ctx.log,
    onChange,
  });
  return tools;
}

function toolsKeyOf(config: Pick<Config, "ytDlpPath" | "ffmpegPath">) {
  return `${config.ytDlpPath}\n${config.ffmpegPath}`;
}

/** Where a redirecting URL points; Electron's fetch doesn't tell the final URL. */
function resolveRedirect(url: string) {
  return new Promise<string>((resolve, reject) => {
    const request = net.request({ url, redirect: "manual" });
    request.on("redirect", (_status, _method, location) => {
      resolve(location);
      request.abort();
    });
    request.on("response", (response) => reject(new Error(`${url} answered HTTP ${response.statusCode} instead of redirecting`)));
    request.on("error", reject);
    request.end();
  });
}

// ---------------------------------------------------------------- state

/** Sends the state to the page and the settings, at most every PUBLISH_INTERVAL_MS while a tool installs. */
class Publisher {
  readonly #ctx: Ctx;
  readonly #tools: Tools;
  #published = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #broadcast = "";

  constructor(ctx: Ctx, tools: Tools) {
    this.#ctx = ctx;
    this.#tools = tools;
    ctx.onCleanup(() => this.#showProgress({ active: undefined, queued: 0 }));
  }

  publish() {
    const wait = PUBLISH_INTERVAL_MS - (Date.now() - this.#published);
    if (!this.#tools.setup || wait <= 0) this.flush();
    else this.#timer ??= this.#ctx.setTimeout(() => this.flush(), wait);
  }

  flush() {
    this.#ctx.clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#published = Date.now();
    const ctx = this.#ctx;
    ctx.setStatus(this.#tools.describe(engineOf(ctx.config)));
    const downloader = downloaders.get(ctx);
    if (!downloader) return;
    ctx.emit("state", stateOf(downloader));
    this.#showProgress(downloader.queue.state);
    this.#broadcastProgress(downloader.queue.state);
  }

  /** API clients get the queue's progress when it changes, as often as the page does. */
  #broadcastProgress(state: QueueState) {
    const json = JSON.stringify(state);
    if (json === this.#broadcast) return;
    this.#broadcast = json;
    this.#ctx.api.broadcast("progress", state);
  }

  // As pear-desktop: progress on the taskbar / dock icon, and how many downloads are left.
  #showProgress({ active, queued }: QueueState) {
    const { window, app } = this.#ctx;
    if (window.isDestroyed()) return;
    window.setProgressBar(active ? Math.max(MIN_TASKBAR_PROGRESS, active.progress) : NO_TASKBAR_PROGRESS);
    app.setBadgeCount(active ? queued + 1 : 0);
  }
}

// ---------------------------------------------------------------- queue

function createQueue(ctx: Ctx, tools: Tools, autoJobs: Set<number>, remember: (result: JobResult) => void, publish: () => void) {
  const ytDlp = createYtDlpEngine(ctx, tools, autoJobs);
  const builtIn = createBuiltInEngine(ctx, tools, autoJobs);
  return new DownloadQueue({
    engines: () => enginesFor(ctx.config, builtIn, ytDlp),
    onState: publish,
    onResult: (result) => {
      autoJobs.delete(result.id);
      if (result.error && !result.cancelled) {
        ctx.log.warn(`${result.label}: ${result.error}`);
        // The site changes; a newer yt-dlp often fixes failing downloads.
        void tools.update(UPDATE_AFTER_FAILURE_MS);
      }
      remember(result);
      notifyWhenHidden(ctx, result);
      ctx.emit("result", result);
      ctx.api.broadcast("result", result);
    },
    log: ctx.log,
  });
}

/** Only yt-dlp when chosen, or for the Custom format's ffmpeg arguments. */
const engineOf = (config: Pick<Config, "engine" | "format">) => (config.format === "custom" ? "yt-dlp" : config.engine);

/** The built-in engine first, then yt-dlp; or yt-dlp alone. */
function enginesFor(config: Pick<Config, "engine" | "format">, builtIn: Engine, ytDlp: Engine): Engine[] {
  return engineOf(config) === "yt-dlp" ? [ytDlp] : [builtIn, ytDlp];
}

function createYtDlpEngine(ctx: Ctx, tools: Tools, autoJobs: Set<number>) {
  let coverWarned = false;
  return new YtDlpEngine({
    prepare: (signal) => tools.ready(signal),
    cookies: sessionCookies(ctx),
    argsFor: (ready, id) => {
      const { config } = ctx;
      if (!coverWarned && !canEmbedCover(config.format, ready.capabilities, config.customExtension)) {
        coverWarned = true;
        ctx.log.warn(`cover art can't be embedded into ${config.format} files without mutagen (pip install mutagen)`);
      }
      return {
        folder: downloadFolder(ctx, autoJobs.has(id)),
        format: config.format,
        template: config.template,
        playlistFolders: config.playlistFolders,
        playlistLimit: config.playlistMaxItems,
        skipExisting: config.skipExisting,
        squareCover: config.squareCover,
        ...(config.skipExisting && config.archive ? { archiveFile: archivePath(downloadFolder(ctx, autoJobs.has(id))) } : {}),
        ffmpegPath: ready.ffmpegPath,
        capabilities: ready.capabilities,
        customArgs: config.customArgs,
        customExtension: config.customExtension,
      };
    },
    log: ctx.log,
  });
}

function createBuiltInEngine(ctx: Ctx, tools: Tools, autoJobs: Set<number>) {
  const session = new InnertubeSession({
    fetch: (input, init) => ctx.session.fetch(input, init),
    cookie: () => accountCookie(ctx),
    poToken: (request: PoTokenRequest) => ctx.request<PoTokenAnswer>("poToken", request, { timeout: PO_TOKEN_TIMEOUT_MS }),
    log: ctx.log,
  });
  const wasm = new WasmConverter({ create: () => createWasmFFmpeg(ctx) });
  return new InnertubeEngine({
    session,
    jobOptions: (id): BuiltInJobOptions => {
      const { config } = ctx;
      return {
        folder: downloadFolder(ctx, autoJobs.has(id)),
        // The Custom format never gets here (enginesFor).
        format: config.format === "custom" ? "source" : config.format,
        template: config.template,
        playlistFolders: config.playlistFolders,
        playlistLimit: config.playlistMaxItems,
        skipExisting: config.skipExisting,
        archive: config.archive,
        squareCover: config.squareCover,
        replayGain: config.replayGain,
        lyrics: config.lyrics,
        lyricsFile: config.lyricsFile,
      };
    },
    converter: (): Converter => chooseConverter(tools.ffmpegProgram, () => wasm),
    cover: (url, square, signal) => fetchCover(ctx, url, square, signal),
    fetch: (url, init) => ctx.session.fetch(url, init),
    lyrics: (query, signal) => findLyrics(query, (url, init) => ctx.session.fetch(url, init), signal),
    log: ctx.log,
  });
}

/** The cookies of a signed-in session, for the built-in engine; none when signed out or not wanted. */
async function accountCookie(ctx: Ctx) {
  if (!ctx.config.useSession) return undefined;
  const cookies = await ctx.session.cookies.get({ url: YTM_ORIGIN });
  if (!cookies.some((cookie) => cookie.name === "SAPISID")) return undefined;
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

/** ffmpeg.wasm's core: in the app's resources when packaged, in node_modules otherwise. */
async function createWasmFFmpeg(ctx: Ctx): Promise<WasmFFmpeg> {
  const dir = ctx.app.isPackaged ? join(process.resourcesPath, "ffmpeg-core") : ffmpegCoreDir();
  const { createFFmpeg } = await import("@ffmpeg.wasm/main");
  return createFFmpeg({ corePath: join(dir, "ffmpeg-core.js"), log: false }) as unknown as WasmFFmpeg;
}

/** The cover art as a JPEG; the site's video thumbnails are 16:9 with the square cover in the middle. */
async function fetchCover(ctx: Ctx, url: string, square: boolean, signal: AbortSignal): Promise<Cover | undefined> {
  const response = await ctx.session.fetch(url, { signal });
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`);
  let image = nativeImage.createFromBuffer(Buffer.from(await response.arrayBuffer()));
  if (image.isEmpty()) return undefined;
  const { width, height } = image.getSize();
  if (square && width !== height) {
    const side = Math.min(width, height);
    image = image.crop({ x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side });
  }
  const size = image.getSize();
  return { data: image.toJPEG(COVER_QUALITY), width: size.width, height: size.height };
}

/** The page's toast can't be seen with the window hidden or minimized; a system notification can. */
function notifyWhenHidden(ctx: Ctx, result: JobResult) {
  const { window, t } = ctx;
  if (!ctx.config.notifyWhenHidden || result.cancelled || !Notification.isSupported()) return;
  if (window.isDestroyed() || (window.isVisible() && !window.isMinimized())) return;
  const notification = new Notification({ title: t("plugins.downloader.name", "Downloader"), body: resultMessage(ctx, result) });
  notification.on("click", () => ctx.focusWindow());
  notification.show();
}

/** What the toast says about a finished download. */
function resultMessage({ t }: Ctx, result: JobResult) {
  if (result.error) return t("plugins.downloader.toast.failed", "Download failed: {{error}}", { error: result.error });
  const count = result.files.length;
  if (count > 1) return t("plugins.downloader.toast.saved-many", "Saved {{count}} songs from “{{title}}”", { count, title: result.label });
  return t("plugins.downloader.toast.saved", "Saved “{{title}}”", { title: result.label });
}

/** Automatic downloads go to their own folder when one is set. */
export function downloadFolder(ctx: Pick<Ctx, "config" | "app">, auto: boolean) {
  const autoFolder = auto ? ctx.config.autoDownloadFolder.trim() : "";
  const folder = expandHome((autoFolder || ctx.config.downloadFolder).trim());
  return folder || ctx.app.getPath("downloads");
}

/** The window's session, as pear-desktop downloaded with it; only the site's cookies, private to this user. */
function sessionCookies(ctx: Ctx) {
  const dir = join(ctx.app.getPath("userData"), "downloader");
  let files = 0;
  return async () => {
    if (!ctx.config.useSession) return undefined;
    const cookies = (await ctx.session.cookies.get({})).filter(isSiteCookie);
    if (cookies.length === 0) return undefined;
    await mkdir(dir, { recursive: true });
    files++;
    const path = join(dir, `cookies-${process.pid}-${files}.txt`);
    await writeFile(path, toNetscape(cookies), { mode: 0o600 });
    return { path, dispose: () => rm(path, { force: true }) };
  };
}

// ---------------------------------------------------------------- automatic downloads

/** "Download everything I listen to": each track once, near its end or once partly played. */
function downloadWhileListening(ctx: Ctx, download: (track: Track) => void) {
  const downloaded = new Set<string>();
  ctx.player.on("change", (state) => {
    const track = state.track;
    if (!track || !ctx.config.autoDownload || downloaded.has(track.videoId)) return;
    if (!isListening(state) || !isDue(ctx.config, track, livePosition(state))) return;
    downloaded.add(track.videoId);
    download(track);
  });
}

const isListening = (state: NowPlaying) => !state.ad && state.status === "playing";

function isDue(config: Config, track: Track, position: number) {
  if (config.autoDownloadMode === "percent") return position >= track.durationSeconds * (config.autoDownloadPercent / 100);
  return track.durationSeconds - position <= config.autoDownloadSeconds;
}

// ---------------------------------------------------------------- commands

export interface ToolsInfo {
  ytDlp: string | undefined;
  ffmpeg: string | undefined;
  sources: { ytDlp: ToolSource | undefined; ffmpeg: ToolSource | undefined };
  capabilities: Capabilities | undefined;
  coverArt: boolean | undefined;
}

/** Where the tools are and what they can do, for the settings. */
export function toolsInfo({ tools }: Downloader, config: Config): ToolsInfo {
  return {
    ytDlp: tools.ytDlp?.path,
    ffmpeg: tools.ffmpeg?.location,
    sources: { ytDlp: tools.ytDlp?.source, ffmpeg: tools.ffmpeg?.source },
    capabilities: tools.capabilities,
    coverArt: tools.capabilities ? canEmbedCover(config.format, tools.capabilities, config.customExtension) : undefined,
  };
}
