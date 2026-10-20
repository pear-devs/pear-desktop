import { definePlugin } from "@pear/sdk";
import { css } from "@pear/sdk/macros" with { type: "macro" };
import { v } from "@pear/sdk/rpc";
import { mkdir } from "node:fs/promises";
import { shell } from "electron";
import { downloaderConfig } from "./config.ts";
import { type DownloaderState, downloadFolder, downloaderOf, openDownloads, startHost, stateOf, toolsInfo } from "./host.ts";
import type { Job } from "./jobs.ts";
import { startPage } from "./page/index.ts";
import type { DownloadTarget } from "./ytdlp.ts";

export default definePlugin({
  id: "downloader",
  name: "Downloader",
  description: "Saves songs, albums and playlists as tagged audio files with cover art.",
  config: downloaderConfig,
  actions: {
    openFolder: { label: "Open the download folder" },
    openDownloads: { label: "Show downloads" },
    updateYtDlp: { label: "Update yt-dlp", description: "Checks for a newer yt-dlp now (when the downloader downloaded it)." },
    cancel: { label: "Cancel all downloads" },
  },
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
      /** Cancels that job, or all of them. */
      cancel(id?: number) {
        const { queue } = downloaderOf(this);
        if (id === undefined) queue.cancelAll();
        else queue.cancel(id);
      },
      /** Pauses that job, or all of them, keeping what they downloaded. */
      pause(id?: number) {
        const { queue } = downloaderOf(this);
        if (id === undefined) queue.pauseAll();
        else queue.pause(id);
      },
      /** Resumes that paused job, or all of them. */
      resume(id?: number) {
        const { queue } = downloaderOf(this);
        if (id === undefined) queue.resumeAll();
        else queue.resume(id);
      },
      retry(id: number) {
        downloaderOf(this).queue.retry(id);
      },
      remove(id: number) {
        downloaderOf(this).queue.remove(id);
      },
      clearFinished() {
        downloaderOf(this).queue.clearFinished();
      },
      jobs(): Job[] {
        return downloaderOf(this).queue.jobs;
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
      openDownloads() {
        openDownloads(this);
      },
      async openFolder() {
        const folder = downloadFolder(this, false);
        await mkdir(folder, { recursive: true });
        const error = await shell.openPath(folder);
        if (error) throw new Error(error);
      },
      updateYtDlp() {
        return downloaderOf(this).tools.updateNow();
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
      queue: {
        summary: "The downloads: the running one, the queued ones, then the finished ones, newest first",
        input: v.optional(v.object({})),
        run(): Job[] {
          return downloaderOf(this).queue.jobs;
        },
      },
      cancel: {
        summary: "Cancel the running download and the queued ones",
        input: v.optional(v.object({})),
        run() {
          downloaderOf(this).queue.cancelAll();
        },
      },
    },
  },
  style: css`
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
    .pear-dl-button:focus-visible {
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
    .pear-dl-page-button {
      display: inline-flex;
      flex: none;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      margin-left: 16px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: rgb(255 255 255 / 0.1);
      color: var(--ytmusic-text-primary, #fff);
      cursor: pointer;
    }
    .pear-dl-page-button[hidden] {
      display: none;
    }
    .pear-dl-page-button:hover,
    .pear-dl-page-button:focus-visible {
      background: rgb(255 255 255 / 0.2);
      outline: none;
    }
    .pear-dl-page-button svg {
      width: 24px;
      height: 24px;
      fill: currentColor;
    }
    /* The Downloads popover: the picker's look, both class names to win over its sheet. */
    .pear-picker-popover.pear-dl-downloads-popover {
      width: 380px;
      max-height: 60vh;
      padding: 0;
      overflow-y: auto;
      overscroll-behavior: contain;
    }
    .pear-picker-popover.pear-dl-downloads-popover[data-side="right"] {
      margin: 0 8px;
    }
    .pear-picker-popover.pear-dl-downloads-popover[data-side="center"] {
      inset: 0;
      height: fit-content;
      margin: auto;
    }
    .pear-picker-popover.pear-dl-downloads-popover .chips {
      position: sticky;
      top: 0;
      z-index: 1;
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 12px 12px 8px;
      background: #212121;
    }
    .pear-picker-popover.pear-dl-downloads-popover .chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border: 1px solid rgb(255 255 255 / 0.2);
      border-radius: 16px;
      background: none;
      color: #fff;
      font: 400 12px Roboto, sans-serif;
      cursor: pointer;
    }
    /* Not the picker's check mark. */
    .pear-picker-popover.pear-dl-downloads-popover .chip::before {
      content: none;
    }
    .pear-picker-popover.pear-dl-downloads-popover .chip[aria-checked="true"] {
      border-color: transparent;
      background: #fff;
      color: #030303;
    }
    .pear-picker-popover.pear-dl-downloads-popover .count {
      opacity: 0.7;
    }
    .pear-picker-popover.pear-dl-downloads-popover ul {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .pear-picker-popover.pear-dl-downloads-popover .job {
      padding: 6px 8px 6px 4px;
    }
    .pear-picker-popover.pear-dl-downloads-popover .job:hover {
      background: rgb(255 255 255 / 0.05);
    }
    .pear-picker-popover.pear-dl-downloads-popover .line {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .pear-picker-popover.pear-dl-downloads-popover .chevron,
    .pear-picker-popover.pear-dl-downloads-popover .action {
      display: inline-flex;
      flex: none;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: none;
      color: #aaa;
      cursor: pointer;
    }
    .pear-picker-popover.pear-dl-downloads-popover .chevron:is(button):hover,
    .pear-picker-popover.pear-dl-downloads-popover .action:hover {
      background: rgb(255 255 255 / 0.1);
      color: #fff;
    }
    .pear-picker-popover.pear-dl-downloads-popover svg {
      width: 20px;
      height: 20px;
      fill: currentColor;
    }
    .pear-picker-popover.pear-dl-downloads-popover .chevron svg {
      transition: transform 0.15s;
    }
    .pear-picker-popover.pear-dl-downloads-popover .chevron[aria-expanded="true"] svg {
      transform: rotate(90deg);
    }
    .pear-picker-popover.pear-dl-downloads-popover .kind {
      display: inline-flex;
      flex: none;
      color: #aaa;
    }
    .pear-picker-popover.pear-dl-downloads-popover .title {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pear-picker-popover.pear-dl-downloads-popover .actions {
      display: inline-flex;
      flex: none;
    }
    .pear-picker-popover.pear-dl-downloads-popover .status {
      padding-left: 60px;
      overflow: hidden;
      color: #aaa;
      font-size: 12px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pear-picker-popover.pear-dl-downloads-popover .job[data-status="failed"] > .status {
      color: #f28b82;
    }
    .pear-picker-popover.pear-dl-downloads-popover progress {
      display: block;
      width: calc(100% - 60px);
      height: 3px;
      margin: 4px 0 2px 60px;
      border: 0;
      appearance: none;
      background: rgb(255 255 255 / 0.15);
    }
    .pear-picker-popover.pear-dl-downloads-popover progress::-webkit-progress-bar {
      background: rgb(255 255 255 / 0.15);
    }
    .pear-picker-popover.pear-dl-downloads-popover progress::-webkit-progress-value {
      background: #fff;
    }
    .pear-picker-popover.pear-dl-downloads-popover .songs {
      margin: 4px 0 0 60px;
    }
    .pear-picker-popover.pear-dl-downloads-popover .song {
      display: flex;
      gap: 12px;
      padding: 3px 4px 3px 0;
      font-size: 13px;
    }
    .pear-picker-popover.pear-dl-downloads-popover .song-status {
      flex: none;
      color: #aaa;
      font-size: 12px;
    }
    .pear-picker-popover.pear-dl-downloads-popover .song[data-status="failed"] .song-status {
      color: #f28b82;
    }
    .pear-picker-popover.pear-dl-downloads-popover .empty {
      padding: 24px 16px;
      text-align: center;
    }
    .pear-picker-popover.pear-dl-downloads-popover .footer {
      position: sticky;
      bottom: 0;
      display: flex;
      justify-content: space-between;
      gap: 8px;
      padding: 8px 12px;
      border-top: 1px solid rgb(255 255 255 / 0.1);
      background: #212121;
    }
    .pear-picker-popover.pear-dl-downloads-popover .footer button {
      padding: 6px 8px;
      border: 0;
      border-radius: 16px;
      background: none;
      color: #3ea6ff;
      font: 500 13px Roboto, sans-serif;
      cursor: pointer;
    }
    .pear-picker-popover.pear-dl-downloads-popover .footer button:hover {
      background: rgb(62 166 255 / 0.15);
    }
    .pear-picker-popover.pear-dl-downloads-popover .footer button:disabled {
      color: #717171;
      cursor: default;
      background: none;
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
