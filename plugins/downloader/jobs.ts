// What a download is, as the queue keeps it and the Downloads window shows it.
// No Node imports: the window uses it too.

import { type DownloadTarget, isAlbum } from "./ytdlp.ts";

export type JobKind = "song" | "album" | "playlist";
export type JobStatus = "queued" | "active" | "paused" | "done" | "failed" | "cancelled";
/** A song of a job: "skipped" when it was downloaded before. */
export type SongStatus = "queued" | "active" | "done" | "failed" | "skipped";
export type Engine = "built-in" | "yt-dlp";

/** How far a song or a whole job is, in bytes, and how fast it goes. */
export interface Transfer {
  /** Bytes in all; unknown until the download starts. */
  size?: number;
  downloaded?: number;
  /** Bytes per second, while downloading. */
  speed?: number;
  /** Seconds left, while downloading. */
  eta?: number;
}

/** A song of an album or playlist. */
export interface JobItem extends Transfer {
  /** 1-based position in the list. */
  index: number;
  videoId?: string;
  /** Empty until the engine knows it. */
  title: string;
  status: SongStatus;
  /** 0–1. */
  progress: number;
  file?: string;
  error?: string;
}

/** A download, as the Downloads window lists it. */
export interface Job extends Transfer {
  id: number;
  target: DownloadTarget;
  label: string;
  kind: JobKind;
  status: JobStatus;
  /** 0–1 over all items of the job. */
  progress: number;
  /** While active. */
  stage?: "starting" | "downloading" | "converting";
  /** The songs of an album or playlist, once the engine lists them. */
  items?: JobItem[];
  files: string[];
  /** Songs kept in the downloader's store but not saved to the folder (video ids); exporting saves them. */
  kept?: string[];
  error?: string;
  /** The engine that did (the rest of) the job. */
  engine?: Engine;
  /** Files a paused job keeps to continue from; removed if it is cancelled instead. */
  partials?: string[];
  /** When it was queued and when it finished, as `Date.now()`. */
  addedAt: number;
  finishedAt?: number;
}

const FINISHED: ReadonlySet<JobStatus> = new Set(["done", "failed", "cancelled"]);

/** Done, failed or cancelled. */
export const isFinished = (job: Pick<Job, "status">) => FINISHED.has(job.status);

/** Queued, running or paused. */
export const isUnfinished = (job: Pick<Job, "status">) => !isFinished(job);

export const kindOf = (target: DownloadTarget): JobKind => {
  if (!target.playlistId) return "song";
  return isAlbum(target.playlistId) ? "album" : "playlist";
};
