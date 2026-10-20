// What the download queue needs from an engine (host only). The queue runs the
// built-in engine first and hands what it couldn't do to yt-dlp.

import type { DownloadTarget } from "../ytdlp.ts";

export interface EngineJob {
  id: number;
  label: string;
  target: DownloadTarget;
}

/** How a job is going, as `JobState` shows it. */
export interface Progress {
  /** Item `index` of `count` (both 1-based) started. */
  item(index: number, count: number, title: string): void;
  /** How much of the job is downloaded, 0–1 over all its items. */
  download(fraction: number): void;
  /** Converting; with the job's progress (0–1) when the converter tells it. */
  converting(fraction?: number): void;
}

export interface EngineResult {
  files: string[];
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
  readonly items: number[] | undefined;

  constructor(message: string, options: { cause?: unknown; files?: string[]; items?: number[] } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "RecoverableError";
    this.files = options.files ?? [];
    this.items = options.items;
  }
}

export const isRecoverable = (error: unknown): error is RecoverableError => error instanceof RecoverableError;
