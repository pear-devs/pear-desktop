import type { DownloaderState, ToolsInfo } from "./host.ts";
import type { DownloadTarget } from "./ytdlp.ts";

/** The host commands, as the page calls them. */
export interface DownloaderCommands {
  /** Queues a download; defaults to the current track. Returns the job id. */
  download(target?: DownloadTarget, label?: string): number;
  cancel(): void;
  state(): DownloaderState;
  info(): ToolsInfo;
  reveal(file: string): void;
}
