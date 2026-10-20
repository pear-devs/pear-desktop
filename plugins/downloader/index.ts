import { join } from "node:path";
import { config, definePlugin, livePosition } from "@pear/sdk";
import { v } from "@pear/sdk/rpc";
import { net, shell } from "electron";
import { style } from "./style.ts";
import { DownloadQueue } from "./downloads.ts";
import type { JobResult, DownloadQueue as Queue, QueueState } from "./downloads.ts";
import { Installer } from "./install.ts";
import { expandHome, type SetupState, Tools } from "./tools.ts";
import {
  type AudioFormat,
  canEmbedCover,
  DEFAULT_TEMPLATE,
  type DownloadTarget,
  isAlbum,
  isDownloadablePlaylist,
} from "./ytdlp.ts";

interface Downloader {
  queue: Queue;
  tools: Tools;
  /** Tool settings the tools were found with; changing them restarts the plugin. */
  toolsKey: string;
}

/** What the page shows: the queue, and yt-dlp or ffmpeg being downloaded. */
export interface DownloaderState extends QueueState {
  setup?: SetupState | undefined;
}

// Per running host instance (commands get the same ctx as `start`).
const downloaders = new WeakMap<object, Downloader>();

function downloaderOf(ctx: { t(key: string, fallback?: string): string }) {
  const downloader = downloaders.get(ctx);
  if (!downloader) throw new Error(ctx.t("plugins.downloader.errors.starting", "the downloader is still starting"));
  return downloader;
}

/** Tests set this to pretend yt-dlp and ffmpeg aren't installed. */
const IGNORE_SYSTEM_TOOLS = "PEAR_DOWNLOADER_IGNORE_SYSTEM_TOOLS";
/** Checking for a newer yt-dlp waits a little after startup. */
const UPDATE_DELAY_MS = 15_000;
/** After a failed download, a newer yt-dlp may fix it; check if the last check is this old. */
const UPDATE_AFTER_FAILURE_MS = 60 * 60 * 1000;

const ICON =
  '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="currentColor" d="M11 4h2v8.17l3.09-3.08 1.41 1.41L12 16l-5.5-5.5 1.41-1.41L11 12.17V4Zm-6 14h14v2H5v-2Z"/></svg>';

export default definePlugin({
  id: "downloader",
  name: "Downloader",
  description: "Saves songs, albums and playlists as tagged audio files with cover art, using yt-dlp.",
  // Option names follow pear-desktop 3.x's where they mean the same (see PLUGIN_MIGRATIONS for the rest).
  config: {
    downloadFolder: config.string("", {
      label: "Download folder",
      placeholder: "Downloads",
      description: "Leave empty for your Downloads folder, like pear-desktop.",
    }),
    format: config.select(
      "mp3",
      [
        { value: "mp3", label: "MP3 (most compatible)" },
        { value: "m4a", label: "M4A / AAC" },
        { value: "opus", label: "Opus (best quality for size)" },
        { value: "source", label: "As streamed (no conversion)" },
      ],
      { label: "Format" },
    ),
    template: config.string(DEFAULT_TEMPLATE, {
      label: "File name",
      placeholder: DEFAULT_TEMPLATE,
      description: "A yt-dlp output template, e.g. %(album)s/%(title)s.%(ext)s",
    }),
    playlistFolders: config.bool(true, { label: "Put albums and playlists in their own folder" }),
    playlistMaxItems: config.number(0, { label: "Most songs per playlist", min: 0, max: 5000, description: "0 means no limit." }),
    skipExisting: config.bool(true, { label: "Skip songs that are already downloaded" }),
    squareCover: config.bool(true, { label: "Crop cover art to a square" }),
    autoDownload: config.bool(false, {
      label: "Download everything I listen to",
      description: "Saves each song shortly before it ends.",
      group: "Automatic downloads",
    }),
    autoDownloadMode: config.select(
      "seconds",
      [
        { value: "seconds", label: "Near the end" },
        { value: "percent", label: "Once partly played" },
      ],
      { label: "When", group: "Automatic downloads" },
    ),
    autoDownloadSeconds: config.number(20, { label: "…this long before the end", min: 1, max: 600, unit: "s", group: "Automatic downloads" }),
    autoDownloadPercent: config.number(10, { label: "…once this much has played", min: 1, max: 100, unit: "%", group: "Automatic downloads" }),
    autoDownloadFolder: config.string("", {
      label: "Folder for these",
      placeholder: "The download folder",
      description: "Leave empty to use the download folder.",
      group: "Automatic downloads",
    }),
    ytDlpPath: config.string("", {
      label: "yt-dlp",
      placeholder: "Found automatically",
      description: "Path to the yt-dlp program.",
      group: "Programs",
    }),
    ffmpegPath: config.string("", {
      label: "ffmpeg",
      placeholder: "Found automatically",
      description: "Path to ffmpeg or its folder; yt-dlp needs it to convert audio.",
      group: "Programs",
    }),
  },
  host: {
    async start(ctx) {
      // Programs missing from the computer are downloaded here when first needed.
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
        onChange: () => publish(),
      });

      // Progress comes per network chunk; the page and the settings need a few updates a second.
      let published = 0;
      let publishTimer: ReturnType<typeof setTimeout> | undefined;
      const flush = () => {
        clearTimeout(publishTimer);
        publishTimer = undefined;
        published = Date.now();
        ctx.setStatus(tools.describe());
        const downloader = downloaders.get(ctx);
        if (downloader) ctx.emit("state", stateOf(downloader.queue, tools));
      };
      const publish = () => {
        const wait = 250 - (Date.now() - published);
        if (!tools.setup || wait <= 0) flush();
        else publishTimer ??= setTimeout(flush, wait);
      };
      ctx.onCleanup(() => clearTimeout(publishTimer));

      await tools.init();
      const folder = (auto: boolean) =>
        expandHome(((auto && ctx.config.autoDownloadFolder.trim()) || ctx.config.downloadFolder).trim()) ||
        ctx.app.getPath("downloads");
      const autoJobs = new Set<number>();
      let coverWarned = false;
      const queue = new DownloadQueue({
        prepare: (signal) => tools.ready(signal),
        argsFor: (ready, id) => {
          if (!coverWarned && !canEmbedCover(ctx.config.format, ready.capabilities)) {
            coverWarned = true;
            ctx.log.warn(`cover art can't be embedded into ${ctx.config.format} files without mutagen (pip install mutagen)`);
          }
          return {
            folder: folder(autoJobs.has(id)),
            format: ctx.config.format,
            template: ctx.config.template,
            playlistFolders: ctx.config.playlistFolders,
            playlistLimit: ctx.config.playlistMaxItems,
            skipExisting: ctx.config.skipExisting,
            squareCover: ctx.config.squareCover,
            ffmpegPath: ready.ffmpegPath,
            capabilities: ready.capabilities,
          };
        },
        onState: () => publish(),
        onResult: (result) => {
          autoJobs.delete(result.id);
          if (result.error && !result.cancelled) {
            ctx.log.warn(`${result.label}: ${result.error}`);
            // The site changes; a newer yt-dlp often fixes failing downloads.
            void tools.update(UPDATE_AFTER_FAILURE_MS);
          }
          ctx.emit("result", result);
          ctx.api.broadcast("result", result);
        },
        log: ctx.log,
      });
      downloaders.set(ctx, { queue, tools, toolsKey: toolsKey(ctx.config) });
      const updateTimer = setTimeout(() => void tools.update(), UPDATE_DELAY_MS);
      ctx.onCleanup(() => {
        clearTimeout(updateTimer);
        queue.dispose();
        downloaders.delete(ctx);
      });
      flush();
      if (tools.ytDlp) ctx.log.info(`yt-dlp ${tools.capabilities?.version ?? ""} at ${tools.ytDlp.path}`);

      const autoDownloaded = new Set<string>();
      ctx.player.on("change", (state) => {
        const track = state.track;
        if (!ctx.config.autoDownload || !track || state.ad || state.status !== "playing" || autoDownloaded.has(track.videoId)) return;
        const position = livePosition(state);
        const due =
          ctx.config.autoDownloadMode === "percent"
            ? position >= track.durationSeconds * (ctx.config.autoDownloadPercent / 100)
            : track.durationSeconds - position <= ctx.config.autoDownloadSeconds;
        if (!due) return;
        autoDownloaded.add(track.videoId);
        autoJobs.add(queue.add({ videoId: track.videoId }, track.title));
      });
    },
    onConfigChange(config, ctx) {
      // Everything else is read per download.
      return downloaders.get(ctx)?.toolsKey === toolsKey(config) ? undefined : "restart";
    },
    commands: {
      /** Queues a download; defaults to the current track. Returns the job id. */
      download(target?: DownloadTarget, label?: string) {
        const { queue } = downloaderOf(this);
        const track = this.player.state.track;
        const resolved = target ?? (track ? { videoId: track.videoId } : undefined);
        if (!resolved?.videoId && !resolved?.playlistId) throw new Error(this.t("plugins.downloader.errors.nothing-playing", "nothing is playing"));
        return queue.add(resolved, label ?? (track?.videoId === resolved.videoId ? track.title : resolved.videoId));
      },
      cancel() {
        downloaderOf(this).queue.cancel();
      },
      state(): DownloaderState {
        const { queue, tools } = downloaderOf(this);
        return stateOf(queue, tools);
      },
      info() {
        const { tools } = downloaderOf(this);
        const format = this.config.format as AudioFormat;
        return {
          ytDlp: tools.ytDlp?.path,
          ffmpeg: tools.ffmpeg?.location,
          sources: { ytDlp: tools.ytDlp?.source, ffmpeg: tools.ffmpeg?.source },
          capabilities: tools.capabilities,
          coverArt: tools.capabilities ? canEmbedCover(format, tools.capabilities) : undefined,
        };
      },
      reveal(file: string) {
        shell.showItemInFolder(file);
      },
    },
    rpc: {
      download: {
        summary: "Queue a download (default: the current track); returns the job id",
        input: v.optional(
          v.object({
            videoId: v.optional(v.pipe(v.string(), v.regex(/^[\w-]{11}$/, "not a video id"))),
            playlistId: v.optional(v.pipe(v.string(), v.regex(/^[\w-]+$/, "not a playlist id"))),
          }),
          {},
        ),
        run({ videoId, playlistId }) {
          const { queue } = downloaderOf(this);
          const track = this.player.state.track;
          const target = videoId || playlistId ? { videoId: videoId ?? "", ...(playlistId ? { playlistId } : {}) } : track && { videoId: track.videoId };
          if (!target) throw new Error("nothing is playing");
          return { id: queue.add(target, track?.videoId === target.videoId ? track.title : (playlistId ?? target.videoId)) };
        },
      },
      state: {
        summary: "The download queue, and yt-dlp or ffmpeg being downloaded",
        input: v.optional(v.object({})),
        run(): DownloaderState {
          const { queue, tools } = downloaderOf(this);
          return stateOf(queue, tools);
        },
      },
      cancel: {
        summary: "Cancel the running download",
        input: v.optional(v.object({})),
        run() {
          downloaderOf(this).queue.cancel();
        },
      },
    },
  },
  style,
  page: async (ctx) => {
    const t = ctx.t;
    const root = document.createElement("div");
    root.className = "pear-dl";
    const button = document.createElement("button");
    button.className = "pear-dl-button";
    button.innerHTML = ICON;
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    const menu = document.createElement("div");
    menu.className = "pear-dl-menu";
    menu.setAttribute("role", "menu");
    menu.hidden = true;
    root.append(button, menu);

    const toast = document.createElement("div");
    toast.className = "pear-dl-toast";
    toast.setAttribute("role", "status");
    toast.hidden = true;
    document.body.append(toast);
    ctx.onCleanup(() => {
      root.remove();
      toast.remove();
    });

    let state: DownloaderState = { active: undefined, queued: 0 };

    const render = () => {
      const active = state.active;
      const setup = state.setup && !state.setup.update ? state.setup : undefined;
      if (setup) {
        // yt-dlp or ffmpeg being downloaded before the first song.
        const fraction = setup.total ? setup.received / setup.total : 0;
        button.dataset.busy = setup.stage === "downloading" ? "downloading" : "converting";
        button.style.setProperty("--pear-dl-progress", String(fraction));
        const vars = { tool: setup.tool, percent: Math.round(fraction * 100) };
        button.title =
          setup.stage === "extracting"
            ? t("plugins.downloader.setup.extracting", "Unpacking {{tool}}…", vars)
            : setup.stage === "verifying"
              ? t("plugins.downloader.setup.verifying", "Checking {{tool}}…", vars)
              : t("plugins.downloader.setup.downloading", "Downloading {{tool}}… {{percent}}%", vars);
      } else if (active) {
        button.dataset.busy = active.stage === "converting" ? "converting" : "downloading";
        button.style.setProperty("--pear-dl-progress", String(active.progress));
        const item = active.item && active.item.count > 1 ? ` (${active.item.index}/${active.item.count})` : "";
        const vars = { title: active.label + item, percent: Math.round(active.progress * 100) };
        const what =
          active.stage === "converting"
            ? t("plugins.downloader.progress.converting", "Converting “{{title}}” – {{percent}}%", vars)
            : active.stage === "starting"
              ? t("plugins.downloader.progress.starting", "Starting “{{title}}”", vars)
              : t("plugins.downloader.progress.downloading", "Downloading “{{title}}” – {{percent}}%", vars);
        const queued = state.queued > 0 ? `, ${t("plugins.downloader.progress.queued", "{{count}} more queued", { count: state.queued })}` : "";
        button.title = what + queued;
      } else {
        delete button.dataset.busy;
        button.title = t("plugins.downloader.templates.button", "Download");
      }
      button.setAttribute("aria-label", button.title);
    };
    render();

    let toastTimer: ReturnType<typeof setTimeout> | undefined;
    const showToast = (message: string, action?: { label: string; run(): void }) => {
      toast.replaceChildren(Object.assign(document.createElement("span"), { textContent: message, title: message }));
      if (action) {
        const actionButton = Object.assign(document.createElement("button"), { textContent: action.label });
        actionButton.addEventListener("click", () => {
          action.run();
          toast.hidden = true;
        });
        toast.append(actionButton);
      }
      toast.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => (toast.hidden = true), 6000);
    };
    ctx.onCleanup(() => clearTimeout(toastTimer));

    const start = async (target: DownloadTarget | undefined, label?: string) => {
      closeMenu();
      try {
        await ctx.host.invoke("download", target, label);
        if (state.active) {
          showToast(t("plugins.downloader.toast.queued", "Queued “{{title}}”", { title: label ?? ctx.player.state.track?.title ?? "" }));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message.replace(/^.*Error: /, "") : String(error);
        showToast(t("plugins.downloader.toast.cannot-download", "Can't download: {{error}}", { error: message }));
      }
    };

    const playlist = () => {
      const fromPage = new URL(location.href).searchParams.get("list") ?? undefined;
      const id = isDownloadablePlaylist(fromPage) ? fromPage : ctx.player.state.track?.playlistId;
      return isDownloadablePlaylist(id) ? id : undefined;
    };

    const options = () => {
      const track = ctx.player.state.track;
      const items: { label: string; run(): void }[] = [];
      if (track) {
        items.push({ label: t("plugins.downloader.menu.download-song", "Download song"), run: () => void start({ videoId: track.videoId }, track.title) });
      }
      const list = playlist();
      if (list) {
        const album = isAlbum(list);
        const label = album ? t("plugins.downloader.labels.album", "album") : t("plugins.downloader.labels.playlist", "playlist");
        items.push({
          label: album
            ? t("plugins.downloader.menu.download-album", "Download album")
            : t("plugins.downloader.menu.download-playlist", "Download playlist"),
          run: () => void start({ videoId: track?.videoId ?? "", playlistId: list }, (album && track?.album) || label),
        });
      }
      if (state.active) {
        items.push({
          label:
            state.queued > 0
              ? t("plugins.downloader.menu.cancel-all", "Cancel downloads")
              : t("plugins.downloader.menu.cancel", "Cancel download"),
          run: () => void ctx.host.invoke("cancel"),
        });
      }
      return items;
    };

    function closeMenu() {
      menu.hidden = true;
      button.setAttribute("aria-expanded", "false");
    }
    const openMenu = (items: { label: string; run(): void }[]) => {
      menu.replaceChildren(
        ...items.map((item) => {
          const entry = Object.assign(document.createElement("button"), { textContent: item.label });
          entry.setAttribute("role", "menuitem");
          entry.addEventListener("click", (event) => {
            event.stopPropagation();
            closeMenu();
            item.run();
          });
          return entry;
        }),
      );
      menu.hidden = false;
      button.setAttribute("aria-expanded", "true");
      menu.querySelector("button")?.focus();
    };

    ctx.listen(button, "click", (event: MouseEvent) => {
      event.stopPropagation();
      if (!menu.hidden) return closeMenu();
      const items = options();
      if (items.length === 0) return showToast(t("plugins.downloader.toast.nothing-playing", "Play something to download it"));
      // A lone song downloads right away; choices open a menu.
      if (items.length === 1 && !state.active) return items[0]!.run();
      openMenu(items);
    });
    ctx.listen(document, "click", (event: MouseEvent) => {
      if (!menu.hidden && !root.contains(event.target as Node)) closeMenu();
    });
    ctx.listen(document, "keydown", (event: KeyboardEvent) => {
      if (event.key === "Escape" && !menu.hidden) {
        closeMenu();
        button.focus();
      }
    });

    const apply = (next: DownloaderState) => {
      const previous = state.setup;
      state = next;
      const setup = next.setup;
      // Say once per program why the first download takes a while.
      if (setup && !setup.update && setup.tool !== previous?.tool) {
        showToast(
          t("plugins.downloader.setup.toast", "Downloading {{tool}}, which saving songs needs. This happens only once.", { tool: setup.tool }),
        );
      }
      render();
    };
    ctx.host.on("state", (payload) => apply(payload as DownloaderState));
    ctx.host.on("result", (payload) => {
      const result = payload as JobResult;
      if (result.cancelled) return showToast(t("plugins.downloader.toast.cancelled", "Download cancelled"));
      if (result.error) return showToast(t("plugins.downloader.toast.failed", "Download failed: {{error}}", { error: result.error }));
      const [file] = result.files;
      const count = result.files.length;
      showToast(
        count > 1
          ? t("plugins.downloader.toast.saved-many", "Saved {{count}} songs from “{{title}}”", { count, title: result.label })
          : t("plugins.downloader.toast.saved", "Saved “{{title}}”", { title: result.label }),
        file ? { label: t("plugins.downloader.toast.show", "Show"), run: () => void ctx.host.invoke("reveal", file) } : undefined,
      );
    });
    ctx.host.invoke("state").then(apply, () => {});

    // Keep the button in the player bar, which YTM may re-render or replace
    // entirely while starting up, so watch the document rather than the bar.
    const place = () => {
      if (root.isConnected) return;
      const volume = ctx.$("player_bar.volume_button");
      if (volume) volume.before(root);
      else ctx.$("player_bar.right_controls_buttons")?.prepend(root);
    };
    await ctx.waitFor("player_bar");
    place();
    const observer = new MutationObserver(place);
    observer.observe(document.body, { childList: true, subtree: true });
    ctx.onCleanup(() => observer.disconnect());
  },
});

function stateOf(queue: Queue, tools: Tools): DownloaderState {
  return { ...queue.state, setup: tools.setup };
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

function toolsKey(config: { ytDlpPath: string; ffmpegPath: string }) {
  return `${config.ytDlpPath}\n${config.ffmpegPath}`;
}
