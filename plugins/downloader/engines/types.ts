// What the download queue needs from an engine (host only). The queue runs the
// built-in engine first and hands what it couldn't do to yt-dlp.

import type { SongStatus } from "../jobs.ts";
import type { DownloadTarget } from "../ytdlp.ts";

export interface EngineJob {
  id: number;
  label: string;
  target: DownloadTarget;
}

/** What an engine tells about one song of a job. */
export interface SongUpdate {
  /** 1-based position in the list (1 for a single song). */
  index: number;
  status?: SongStatus;
  videoId?: string;
  title?: string;
  /** Bytes of the song's stream received so far, and in all. */
  bytes?: number;
  total?: number;
  file?: string;
  error?: string;
}

/** How a job is going, as `JobState` shows it. */
export interface Progress {
  /** Item `index` of `count` (both 1-based) started. */
  item(index: number, count: number, title: string): void;
  /** How much of the job is downloaded, 0–1 over all its items. */
  download(fraction: number): void;
  /** Converting; with the job's progress (0–1) when the converter tells it. */
  converting(fraction?: number): void;
  /** The list's songs, once known; `count` placeholders when only their number is. */
  songs(songs: { index: number; videoId?: string; title?: string }[]): void;
  song(update: SongUpdate): void;
  /** A file to keep while the job is paused, to continue from later. */
  partial(file: string): void;
}

/** The reason a job's signal is aborted with when it is paused, not cancelled: its partial files stay. */
export class PauseRequest extends Error {
  constructor() {
    super("paused");
    this.name = "PauseRequest";
  }
}

export const isPause = (signal: AbortSignal) => signal.aborted && signal.reason instanceof PauseRequest;

export interface EngineResult {
  files: string[];
  /** Songs kept in the downloader's store instead of saved to the folder (by video id). */
  kept?: string[];
  /** Why some items of a playlist failed, when others were saved. */
  error?: string;
}

export interface Engine {
  readonly name: "built-in" | "yt-dlp";
  download(job: EngineJob, progress: Progress, signal: AbortSignal): Promise<EngineResult>;
}

/**
 * The engine couldn't do this, but another may: the site changed under it, or a
 * stream refused it. `items` are the playlist positions left (all of them when
 * undefined); `files` what was saved before.
 */
export class RecoverableError extends Error {
  readonly files: string[];
  readonly kept: string[];
  readonly items: number[] | undefined;

  constructor(message: string, options: { cause?: unknown; files?: string[]; kept?: string[]; items?: number[] } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "RecoverableError";
    this.files = options.files ?? [];
    this.kept = options.kept ?? [];
    this.items = options.items;
  }
}

export const isRecoverable = (error: unknown): error is RecoverableError => error instanceof RecoverableError;
