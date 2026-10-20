import { join } from "node:path";
import { config, definePlugin, livePosition } from "@pear/sdk";
import { v } from "@pear/sdk/rpc";
import { shell } from "electron";
import { style } from "./style.ts";
import { DownloadQueue } from "./downloads.ts";
import type { JobResult, DownloadQueue as Queue, QueueState } from "./downloads.ts";
import { expandHome, probe, resolveYtDlp } from "./tools.ts";
import {
  type AudioFormat,
  type Capabilities,
  canEmbedCover,
  DEFAULT_TEMPLATE,
  type DownloadTarget,
  isAlbum,
  isDownloadablePlaylist,
} from "./ytdlp.ts";

interface Downloader {
  queue: Queue;
  capabilities: Capabilities;
  ytDlp: string;
  /** Tool settings the probe was made with; changing them restarts the plugin. */
  tools: string;
}

// Per running host instance (commands get the same ctx as `start`).
const downloaders = new WeakMap<object, Downloader>();

function downloaderOf(ctx: object) {
  const downloader = downloaders.get(ctx);
  if (!downloader) throw new Error("the downloader is still starting");
  return downloader;
}

const ICON =
  '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="currentColor" d="M11 4h2v8.17l3.09-3.08 1.41 1.41L12 16l-5.5-5.5 1.41-1.41L11 12.17V4Zm-6 14h14v2H5v-2Z"/></svg>';

export default definePlugin({
  id: "downloader",
  name: "Downloader",
  description: "Saves songs, albums and playlists as tagged audio files with cover art, using yt-dlp.",
  config: {
    folder: config.string("", {
      label: "Download folder",
      placeholder: "Music/Pear Desktop",
      description: "Leave empty for a Pear Desktop folder in your Music folder.",
    }),
    format: config.select(
      "mp3",
      [
        { value: "mp3", label: "MP3 (most compatible)" },
        { value: "m4a", label: "M4A / AAC" },
        { value: "opus", label: "Opus (best quality for size)" },
      ],
      { label: "Format" },
    ),
    template: config.string(DEFAULT_TEMPLATE, {
      label: "File name",
      placeholder: DEFAULT_TEMPLATE,
      description: "A yt-dlp output template, e.g. %(album)s/%(title)s.%(ext)s",
    }),
    playlistFolders: config.bool(true, { label: "Put albums and playlists in their own folder" }),
    playlistLimit: config.number(0, { label: "Most songs per playlist", min: 0, max: 5000, description: "0 means no limit." }),
    skipExisting: config.bool(true, { label: "Skip songs that are already downloaded" }),
    squareCover: config.bool(true, { label: "Crop cover art to a square" }),
    autoDownload: config.bool(false, {
      label: "Download everything I listen to",
      description: "Saves each song shortly before it ends.",
    }),
    autoDownloadSeconds: config.number(20, { label: "…this long before the end", min: 1, max: 600, unit: "s" }),
    ytDlpPath: config.string("", { label: "yt-dlp", placeholder: "Found automatically", description: "Path to the yt-dlp program." }),
    ffmpegPath: config.string("", {
      label: "ffmpeg",
      placeholder: "Found automatically",
      description: "Path to ffmpeg or its folder; yt-dlp needs it to convert audio.",
    }),
  },
  host: {
    async start(ctx) {
      const ytDlp = resolveYtDlp(ctx.config.ytDlpPath);
      const ffmpegPath = expandHome(ctx.config.ffmpegPath.trim());
      const capabilities = await probe(ytDlp, ffmpegPath);
      if (!capabilities.ffmpeg) {
        throw new Error(
          "yt-dlp can't find ffmpeg, which it needs to convert audio. Install ffmpeg (https://ffmpeg.org/download.html) or set its path in the plugin settings.",
        );
      }
      const folder = () => expandHome(ctx.config.folder.trim()) || join(ctx.app.getPath("music"), "Pear Desktop");
      const queue = new DownloadQueue({
        ytDlp,
        argsFor: () => ({
          folder: folder(),
          format: ctx.config.format,
          template: ctx.config.template,
          playlistFolders: ctx.config.playlistFolders,
          playlistLimit: ctx.config.playlistLimit,
          skipExisting: ctx.config.skipExisting,
          squareCover: ctx.config.squareCover,
          ffmpegPath,
          capabilities,
        }),
        onState: (state) => ctx.emit("state", state),
        onResult: (result) => {
          if (result.error && !result.cancelled) ctx.log.warn(`${result.label}: ${result.error}`);
          ctx.emit("result", result);
          ctx.api.broadcast("result", result);
        },
        log: ctx.log,
      });
      downloaders.set(ctx, { queue, capabilities, ytDlp, tools: toolsKey(ctx.config) });
      ctx.onCleanup(() => {
        queue.dispose();
        downloaders.delete(ctx);
      });
      if (!canEmbedCover(ctx.config.format, capabilities)) {
        ctx.log.warn(`cover art can't be embedded into ${ctx.config.format} files without mutagen (pip install mutagen)`);
      }
      ctx.log.info(`yt-dlp ${capabilities.version} at ${ytDlp}`);

      const autoDownloaded = new Set<string>();
      ctx.player.on("change", (state) => {
        const track = state.track;
        if (!ctx.config.autoDownload || !track || state.ad || state.status !== "playing" || autoDownloaded.has(track.videoId)) return;
        if (track.durationSeconds - livePosition(state) > ctx.config.autoDownloadSeconds) return;
        autoDownloaded.add(track.videoId);
        queue.add({ videoId: track.videoId }, track.title);
      });
    },
    onConfigChange(config, ctx) {
      // Everything else is read per download.
      return downloaders.get(ctx)?.tools === toolsKey(config) ? undefined : "restart";
    },
    commands: {
      /** Queues a download; defaults to the current track. Returns the job id. */
      download(target?: DownloadTarget, label?: string) {
        const { queue } = downloaderOf(this);
        const track = this.player.state.track;
        const resolved = target ?? (track ? { videoId: track.videoId } : undefined);
        if (!resolved?.videoId && !resolved?.playlistId) throw new Error("nothing is playing");
        return queue.add(resolved, label ?? (track?.videoId === resolved.videoId ? track.title : resolved.videoId));
      },
      cancel() {
        downloaderOf(this).queue.cancel();
      },
      state(): QueueState {
        return downloaderOf(this).queue.state;
      },
      info() {
        const { capabilities, ytDlp } = downloaderOf(this);
        const format = this.config.format as AudioFormat;
        return { ytDlp, capabilities, coverArt: canEmbedCover(format, capabilities) };
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
        summary: "The download queue",
        input: v.optional(v.object({})),
        run(): QueueState {
          return downloaderOf(this).queue.state;
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

    let state: QueueState = { active: undefined, queued: 0 };
    const idleLabel = "Download";

    const render = () => {
      const active = state.active;
      if (active) {
        button.dataset.busy = active.stage === "converting" ? "converting" : "downloading";
        button.style.setProperty("--pear-dl-progress", String(active.progress));
        const item = active.item && active.item.count > 1 ? ` (${active.item.index}/${active.item.count})` : "";
        const what = active.stage === "converting" ? "Converting" : active.stage === "starting" ? "Starting" : "Downloading";
        const queued = state.queued > 0 ? `, ${state.queued} more queued` : "";
        button.title = `${what} “${active.label}”${item} – ${Math.round(active.progress * 100)}%${queued}`;
      } else {
        delete button.dataset.busy;
        button.title = idleLabel;
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
        if (state.active) showToast(`Queued “${label ?? ctx.player.state.track?.title ?? "download"}”`);
      } catch (error) {
        showToast(`Can't download: ${error instanceof Error ? error.message.replace(/^.*Error: /, "") : String(error)}`);
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
      if (track) items.push({ label: "Download song", run: () => void start({ videoId: track.videoId }, track.title) });
      const list = playlist();
      if (list) {
        const kind = isAlbum(list) ? "album" : "playlist";
        items.push({
          label: `Download ${kind}`,
          run: () => void start({ videoId: track?.videoId ?? "", playlistId: list }, (isAlbum(list) && track?.album) || kind),
        });
      }
      if (state.active) items.push({ label: state.queued > 0 ? "Cancel downloads" : "Cancel download", run: () => void ctx.host.invoke("cancel") });
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
      if (items.length === 0) return showToast("Play something to download it");
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

    ctx.host.on("state", (payload) => {
      state = payload as QueueState;
      render();
    });
    ctx.host.on("result", (payload) => {
      const result = payload as JobResult;
      if (result.cancelled) return showToast("Download cancelled");
      if (result.error) return showToast(`Download failed: ${result.error}`);
      const [file] = result.files;
      const count = result.files.length;
      showToast(
        count > 1 ? `Saved ${count} songs from “${result.label}”` : `Saved “${result.label}”`,
        file ? { label: "Show", run: () => void ctx.host.invoke("reveal", file) } : undefined,
      );
    });
    ctx.host.invoke("state").then(
      (initial) => {
        state = initial;
        render();
      },
      () => {},
    );

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

function toolsKey(config: { ytDlpPath: string; ffmpegPath: string }) {
  return `${config.ytDlpPath}\n${config.ffmpegPath}`;
}
