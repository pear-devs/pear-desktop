import { definePlugin } from "@pear/sdk";
import { css } from "@pear/sdk/macros" with { type: "macro" };
import { v } from "@pear/sdk/rpc";
import { shell } from "electron";
import { downloaderConfig } from "./config.ts";
import { type DownloaderState, downloaderOf, startHost, stateOf, toolsInfo } from "./host.ts";
import { startPage } from "./page/index.ts";
import type { DownloadTarget } from "./ytdlp.ts";

export default definePlugin({
  id: "downloader",
  name: "Downloader",
  description: "Saves songs, albums and playlists as tagged audio files with cover art.",
  config: downloaderConfig,
  host: {
    start: startHost,
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
        return stateOf(downloaderOf(this));
      },
      info() {
        return toolsInfo(downloaderOf(this), this.config);
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
          const target = requestedTarget(videoId, playlistId) ?? (track && { videoId: track.videoId });
          if (!target) throw new Error("nothing is playing");
          return { id: queue.add(target, track?.videoId === target.videoId ? track.title : (playlistId ?? target.videoId)) };
        },
      },
      state: {
        summary: "The download queue, and yt-dlp or ffmpeg being downloaded",
        input: v.optional(v.object({})),
        run(): DownloaderState {
          return stateOf(downloaderOf(this));
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
  style: css`
    .pear-dl {
      position: relative;
      display: inline-flex;
    }
    .pear-dl-button {
      --pear-dl-progress: 0;
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      margin: 0 4px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: none;
      color: var(--ytmusic-text-secondary, #aaa);
      cursor: pointer;
    }
    .pear-dl-button:hover,
    .pear-dl-button:focus-visible,
    .pear-dl-button[aria-expanded="true"] {
      color: var(--ytmusic-text-primary, #fff);
      background: rgb(255 255 255 / 0.1);
      outline: none;
    }
    .pear-dl-button[data-busy]::before {
      content: "";
      position: absolute;
      inset: 3px;
      border-radius: 50%;
      background: conic-gradient(#fff calc(var(--pear-dl-progress) * 1turn), rgb(255 255 255 / 0.15) 0);
      mask: radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 2px));
    }
    .pear-dl-button[data-busy="converting"]::before {
      animation: pear-dl-pulse 1s ease-in-out infinite alternate;
    }
    .pear-dl-button svg {
      position: relative;
      width: 24px;
      height: 24px;
      fill: currentColor;
    }
    @keyframes pear-dl-pulse {
      from {
        opacity: 1;
      }
      to {
        opacity: 0.35;
      }
    }
    .pear-dl-menu {
      position: absolute;
      bottom: calc(100% + 8px);
      right: 0;
      z-index: 10;
      min-width: 200px;
      padding: 8px 0;
      border-radius: 8px;
      background: var(--ytmusic-menu-background, #212121);
      box-shadow: 0 4px 16px rgb(0 0 0 / 0.5);
    }
    .pear-dl-menu[hidden] {
      display: none;
    }
    .pear-dl-menu button {
      display: block;
      width: 100%;
      padding: 10px 16px;
      border: 0;
      background: none;
      color: var(--ytmusic-text-primary, #fff);
      font: 400 14px Roboto, "Noto Naskh Arabic UI", Arial, sans-serif;
      text-align: left;
      white-space: nowrap;
      cursor: pointer;
    }
    .pear-dl-menu button:hover,
    .pear-dl-menu button:focus-visible {
      background: rgb(255 255 255 / 0.1);
      outline: none;
    }
    .pear-dl-toast {
      position: fixed;
      left: 50%;
      bottom: calc(var(--ytmusic-player-bar-height, 72px) + 16px);
      z-index: 1000;
      display: flex;
      align-items: center;
      gap: 16px;
      max-width: min(560px, 90vw);
      padding: 12px 16px;
      border-radius: 6px;
      background: #f1f1f1;
      color: #0f0f0f;
      font: 400 14px Roboto, Arial, sans-serif;
      box-shadow: 0 4px 16px rgb(0 0 0 / 0.4);
      transform: translate(-50%, 0);
      transition:
        opacity 0.2s,
        transform 0.2s;
    }
    .pear-dl-toast[hidden] {
      display: flex;
      opacity: 0;
      pointer-events: none;
      transform: translate(-50%, 12px);
    }
    .pear-dl-toast span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pear-dl-toast button {
      flex: none;
      padding: 0;
      border: 0;
      background: none;
      color: #065fd4;
      font: 500 14px Roboto, Arial, sans-serif;
      cursor: pointer;
    }
  `,
  page: startPage,
});

/** The RPC's video or playlist, if it named one. */
function requestedTarget(videoId: string | undefined, playlistId: string | undefined): DownloadTarget | undefined {
  if (!videoId && !playlistId) return undefined;
  const target: DownloadTarget = { videoId: videoId ?? "" };
  if (playlistId) target.playlistId = playlistId;
  return target;
}
