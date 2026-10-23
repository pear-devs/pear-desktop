import type { Job } from "./jobs.ts";
import type { DownloaderState, ToolsInfo } from "./host.ts";
import type { OfflineData, OfflineTrack } from "./offline.ts";
import type { DownloadTarget } from "./ytdlp.ts";

/** The host commands, as the page calls them. */
export interface DownloaderCommands {
  /** Queues a download; defaults to the current track. Returns the job id. */
  download(target?: DownloadTarget, label?: string): number;
  /** Cancels that job, or all of them. */
  cancel(id?: number): void;
  /** Pauses that job, or all of them, keeping what they downloaded. */
  pause(id?: number): void;
  /** Resumes that paused job, or all of them. */
  resume(id?: number): void;
  /** Downloads a failed or cancelled job again. */
  retry(id: number): void;
  /** Takes a queued or finished job off the list. */
  remove(id: number): void;
  clearFinished(): void;
  /** The running job, the queued ones, then the finished ones, newest first. */
  jobs(): Job[];
  state(): DownloaderState;
  info(): ToolsInfo;
  reveal(file: string): void;
  openFolder(): Promise<void>;
  /** Shows the Downloads popover in the page, pinned open. */
  openDownloads(): void;
  updateYtDlp(): Promise<void>;
  /** The songs kept for offline playback, newest first. */
  offlineTracks(): Promise<OfflineTrack[]>;
  /** A kept song with its stream, for the page to write into the site's offline databases. */
  offlineTrack(videoId: string): Promise<OfflineData | undefined>;
  /** Forgets a kept song (removed in the site's Downloads page). */
  offlineRemove(videoId: string): Promise<void>;
}
