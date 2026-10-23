import { definePlugin } from "@pear/sdk";
import { css } from "@pear/sdk/macros" with { type: "macro" };
import { v } from "@pear/sdk/rpc";
import { mkdir } from "node:fs/promises";
import { shell } from "electron";
import { downloaderConfig } from "./config.ts";
import { type DownloaderState, downloadFolder, downloaderOf, openDownloads, startHost, stateOf, toolsInfo } from "./host.ts";
import type { Job } from "./jobs.ts";
import type { OfflineData, OfflineList, OfflineTrack } from "./offline.ts";
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
      /** Saves the songs a finished download kept in the app into the download folder; resolves with their files. */
      async export(id: number): Promise<string[]> {
        const { queue, builtIn, builtInOptions } = downloaderOf(this);
        const kept = queue.jobs.find((job) => job.id === id)?.kept ?? [];
        const options = builtInOptions();
        const files: string[] = [];
        for (const videoId of kept) {
          const file = await builtIn.export(videoId, options, new AbortController().signal);
          queue.exported(id, videoId, file);
          files.push(file);
        }
        return files;
      },
      offlineTracks(): Promise<OfflineTrack[]> {
        return downloaderOf(this).offline.list();
      },
      offlineTrack(videoId: string): Promise<OfflineData | undefined> {
        return downloaderOf(this).offline.read(videoId);
      },
      offlineRemove(videoId: string) {
        return downloaderOf(this).offline.remove(videoId);
      },
      offlineLists(): Promise<OfflineList[]> {
        return downloaderOf(this).offline.lists();
      },
      offlineRemoveList(playlistId: string): Promise<string[]> {
        return downloaderOf(this).offline.removeList(playlistId);
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
    /*
     * The Downloads popover and the Downloads page's queue strip. The popover has
     * the picker's classes too: both class names, to win over its sheet.
     */
    :is(.pear-picker-popover.pear-dl-downloads-popover, .pear-dl-section) {
      /* YTM's colours: its menus' surface, its text, white progress and its link blue. */
      --pear-dl-surface: #212121;
      --pear-dl-surface-high: #212121;
      --pear-dl-on-surface: var(--ytmusic-text-primary, #fff);
      --pear-dl-on-surface-variant: var(--ytmusic-text-secondary, #aaa);
      --pear-dl-outline: #909090;
      --pear-dl-outline-variant: rgb(255 255 255 / 0.1);
      --pear-dl-primary: #3ea6ff;
      --pear-dl-fill: #fff;
      --pear-dl-track: rgb(255 255 255 / 0.15);
      --pear-dl-tertiary: #3ea6ff;
      --pear-dl-error: #f28b82;
      color: var(--pear-dl-on-surface);
      font: 400 14px/20px Roboto, sans-serif;
    }
    .pear-picker-popover.pear-dl-downloads-popover {
      width: 300px;
      padding: 16px;
      border: 0;
      border-radius: 16px;
      background: var(--pear-dl-surface);
      box-shadow: 0 4px 8px 3px rgb(0 0 0 / 0.15), 0 1px 3px rgb(0 0 0 / 0.3);
    }
    .pear-picker-popover.pear-dl-downloads-popover[data-side="right"] {
      margin: 0 8px;
    }
    .pear-picker-popover.pear-dl-downloads-popover[data-side="center"] {
      inset: 0;
      height: fit-content;
      margin: auto;
    }
    :is(.pear-picker-popover.pear-dl-downloads-popover, .pear-dl-section) svg {
      flex: none;
      width: 20px;
      height: 20px;
      fill: currentColor;
    }
    :is(.pear-picker-popover.pear-dl-downloads-popover, .pear-dl-section) .ring {
      width: auto;
      height: auto;
      fill: none;
    }
    :is(.pear-picker-popover.pear-dl-downloads-popover, .pear-dl-section) .ring-track {
      fill: none;
      stroke: var(--pear-dl-track);
    }
    :is(.pear-picker-popover.pear-dl-downloads-popover, .pear-dl-section) .ring-value {
      fill: none;
      stroke: var(--pear-dl-fill);
      stroke-linecap: round;
      transition: stroke-dasharray 0.3s;
    }
    :is(.pear-picker-popover.pear-dl-downloads-popover, .pear-dl-section) .text-button {
      flex: none;
      height: 40px;
      padding: 0 12px;
      border: 0;
      border-radius: 20px;
      background: transparent;
      color: var(--pear-dl-primary);
      font: 500 14px/20px Roboto, sans-serif;
      white-space: nowrap;
      cursor: pointer;
    }
    :is(.pear-picker-popover.pear-dl-downloads-popover, .pear-dl-section) .text-button.small {
      height: 32px;
      border-radius: 16px;
      font-size: 13px;
    }
    :is(.pear-picker-popover.pear-dl-downloads-popover, .pear-dl-section) .icon-button {
      display: inline-flex;
      flex: none;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: var(--pear-dl-on-surface-variant);
      cursor: pointer;
    }
    :is(.pear-picker-popover.pear-dl-downloads-popover, .pear-dl-section) .icon-button.small {
      width: 32px;
      height: 32px;
      color: var(--pear-dl-outline);
    }
    :is(.pear-picker-popover.pear-dl-downloads-popover, .pear-dl-section) .icon-button.small svg {
      width: 16px;
      height: 16px;
    }
    :is(.pear-picker-popover.pear-dl-downloads-popover, .pear-dl-section) .text-button:hover,
    :is(.pear-picker-popover.pear-dl-downloads-popover, .pear-dl-section) .text-button:focus-visible {
      background: color-mix(in srgb, var(--pear-dl-primary) 8%, transparent);
      outline: none;
    }
    :is(.pear-picker-popover.pear-dl-downloads-popover, .pear-dl-section) .icon-button:hover,
    :is(.pear-picker-popover.pear-dl-downloads-popover, .pear-dl-section) .icon-button:focus-visible {
      background: color-mix(in srgb, var(--pear-dl-on-surface) 8%, transparent);
      color: var(--pear-dl-on-surface);
      outline: none;
    }
    :is(.pear-picker-popover.pear-dl-downloads-popover, .pear-dl-section) :is(.text-button, .icon-button):disabled {
      opacity: 0.38;
      cursor: default;
      background: transparent;
    }
    /* The popover: the download in front. */
    .pear-dl-summary {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .pear-dl-summary .summary-main {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .pear-dl-summary .summary-ring {
      position: relative;
      display: grid;
      flex: none;
      place-items: center;
      width: 72px;
      height: 72px;
    }
    .pear-dl-summary .summary-ring .ring {
      position: absolute;
      inset: 0;
    }
    .pear-dl-summary .summary-percent {
      font: 500 16px/20px Roboto, sans-serif;
    }
    .pear-dl-summary .summary-text {
      flex: 1;
      min-width: 0;
    }
    .pear-dl-summary :is(.summary-phase, .summary-name) {
      overflow: hidden;
      color: var(--pear-dl-on-surface-variant);
      font: 400 12px/16px Roboto, sans-serif;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pear-dl-summary .summary-count {
      overflow: hidden;
      font: 400 24px/32px Roboto, sans-serif;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pear-dl-summary .summary-footer {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 0 -4px -6px;
      padding-top: 10px;
      border-top: 1px solid var(--pear-dl-outline-variant);
    }
    .pear-dl-summary :is(.summary-failed, .summary-waiting) {
      padding-left: 4px;
      color: var(--pear-dl-on-surface-variant);
      font: 400 12px/16px Roboto, sans-serif;
      white-space: nowrap;
    }
    .pear-dl-summary .summary-failed {
      color: var(--pear-dl-error);
      font-weight: 500;
    }
    :is(.pear-picker-popover.pear-dl-downloads-popover, .pear-dl-section) .spacer {
      flex: 1;
    }
    /* The Downloads page: no Library tab bar, and our sidebar entry is the highlighted one. */
    html[pear-dl-downloads-page] sel(browse.tabs) {
      display: none;
    }
    html[pear-dl-downloads-page] sel(guide.active_entry) tp-yt-paper-item {
      background: transparent;
    }
    html[pear-dl-downloads-page] sel(guide.active_entry) .title {
      font-weight: 400;
    }
    /* As wide as the page's shelves, as the site sizes them. */
    .pear-dl-section {
      width: var(--ytmusic-content-width);
      margin: 0 auto 24px;
    }
    .pear-dl-section:empty {
      display: none;
    }
    .pear-dl-queue {
      overflow: hidden;
      border-radius: 12px;
      background: var(--pear-dl-surface-high);
    }
    .pear-dl-queue .strip {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 8px 8px 12px;
      cursor: pointer;
    }
    .pear-dl-queue .strip-text {
      flex: 1;
      min-width: 0;
    }
    .pear-dl-queue .strip-title {
      overflow: hidden;
      font-weight: 500;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pear-dl-queue .strip-sub {
      display: flex;
      gap: 6px;
      overflow: hidden;
      color: var(--pear-dl-on-surface-variant);
      font: 400 12px/16px Roboto, sans-serif;
      white-space: nowrap;
    }
    .pear-dl-queue .dot {
      margin-right: 6px;
    }
    .pear-dl-queue .failed {
      color: var(--pear-dl-error);
    }
    .pear-dl-queue .failed .dot {
      color: var(--pear-dl-on-surface-variant);
    }
    .pear-dl-queue .chevron svg {
      transition: transform 0.15s;
    }
    .pear-dl-queue .chevron[aria-expanded="true"] svg {
      transform: rotate(180deg);
    }
    .pear-dl-queue .strip-body {
      border-top: 1px solid var(--pear-dl-outline-variant);
    }
    .pear-dl-queue .rows {
      max-height: 280px;
      margin: 0;
      padding: 4px 0;
      overflow: auto;
      list-style: none;
    }
    .pear-dl-queue .row {
      position: relative;
      display: flex;
      align-items: center;
      gap: 12px;
      min-height: 44px;
      padding: 0 8px 0 16px;
      box-sizing: border-box;
    }
    .pear-dl-queue .row:hover {
      background: color-mix(in srgb, var(--pear-dl-on-surface) 4%, transparent);
    }
    .pear-dl-queue .row-icon {
      display: flex;
      color: var(--pear-dl-on-surface-variant);
    }
    .pear-dl-queue .row-icon svg {
      width: 18px;
      height: 18px;
    }
    .pear-dl-queue .row[data-status="downloading"] :is(.row-icon, .row-state) {
      color: var(--pear-dl-fill);
    }
    .pear-dl-queue .row[data-status="converting"] :is(.row-icon, .row-state) {
      color: var(--pear-dl-tertiary);
    }
    .pear-dl-queue .row:is([data-status="failed"], [data-status="cancelled"]) .row-icon {
      color: var(--pear-dl-error);
    }
    .pear-dl-queue .row-text {
      flex: 1;
      min-width: 0;
      padding: 4px 0;
    }
    .pear-dl-queue .row-title {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pear-dl-queue .row[data-status="queued"] .row-title,
    .pear-dl-queue .row-title.muted {
      color: var(--pear-dl-on-surface-variant);
    }
    .pear-dl-queue .row-sub {
      overflow: hidden;
      color: var(--pear-dl-outline);
      font: 400 11px/14px Roboto, sans-serif;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pear-dl-queue .row-state {
      flex: none;
      max-width: 40%;
      overflow: hidden;
      color: var(--pear-dl-outline);
      font: 400 12px/16px Roboto, sans-serif;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pear-dl-queue .row-state.mono {
      font-family: "Roboto Mono", monospace;
    }
    .pear-dl-queue .row-state.error {
      color: var(--pear-dl-error);
    }
    .pear-dl-queue .icon-space {
      flex: none;
      width: 32px;
    }
    .pear-dl-queue .actions {
      display: inline-flex;
      flex: none;
    }
    .pear-dl-queue .history {
      padding-left: 46px;
    }
    .pear-dl-queue .row-progress {
      position: absolute;
      right: 0;
      bottom: 0;
      left: 0;
      height: 3px;
      background: var(--pear-dl-track);
    }
    .pear-dl-queue .bar {
      position: absolute;
      top: 0;
      bottom: 0;
      left: 0;
    }
    .pear-dl-queue .bar.download {
      background: var(--pear-dl-fill);
    }
    /* Converting says nothing of how far it is. */
    .pear-dl-queue .bar.convert {
      right: 0;
      background: var(--pear-dl-tertiary);
      animation: pear-dl-pulse 1s ease-in-out infinite alternate;
    }
    .pear-dl-queue .strip-footer {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      border-top: 1px solid var(--pear-dl-outline-variant);
    }
    .pear-dl-queue .legend {
      display: flex;
      flex: 1;
      gap: 12px;
      padding-left: 8px;
      color: var(--pear-dl-on-surface-variant);
      font: 400 12px/16px Roboto, sans-serif;
    }
    .pear-dl-queue .legend[hidden] {
      visibility: hidden;
    }
    .pear-dl-queue .legend-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .pear-dl-queue .legend-item::before {
      content: "";
      width: 12px;
      height: 3px;
      background: var(--pear-dl-fill);
    }
    .pear-dl-queue .legend-item.convert::before {
      background: var(--pear-dl-tertiary);
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
