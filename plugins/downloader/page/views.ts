// What the Downloads popover and the Downloads page's queue show, worked out
// from the jobs: the download in front, how far it is, what else waits, and a
// row per song still to go. Pure, so it is unit-testable.

import { isFinished, type Job, type JobItem } from "../jobs.ts";

/** Something downloads (or waits to); all of it is paused; only failed or cancelled ones are left; all are done; nothing at all. */
export type Phase = "running" | "paused" | "stopped" | "done" | "empty";

export type RowStatus = "downloading" | "converting" | "queued" | "paused" | "failed" | "cancelled";

/** A song still to go, or a whole download when its songs don't show (it isn't the one in front, or it failed). */
export interface Row {
  key: string;
  job: Job;
  /** The song of the album or playlist in front. */
  item?: JobItem;
  title: string;
  status: RowStatus;
  /** 0–1. */
  progress: number;
  error?: string | undefined;
}

export interface Summary {
  phase: Phase;
  /** The download in front: the running one, else the next to run, else a paused one (one that got somewhere first), a failed or the last finished one. */
  current?: Job | undefined;
  /** Songs of the one in front, done and in all; 1 song for a song. */
  songsDone: number;
  songsTotal: number;
  /** Failed downloads, not yet retried or removed. */
  failed: number;
  /** Downloads after the one in front that wait, run or are paused. */
  waiting: number;
  rows: Row[];
  /** The finished ones, newest first. */
  finished: Job[];
}

const isLive = (job: Job) => !isFinished(job);
const isStopped = (job: Job) => job.status === "failed" || job.status === "cancelled";
const isLeft = (item: JobItem) => item.status !== "done" && item.status !== "skipped";

/** Jobs come running first, then queued, paused and finished, newest first (as the queue lists them). */
export function summarize(jobs: readonly Job[]): Summary {
  const live = jobs.filter(isLive);
  const stopped = jobs.filter(isStopped);
  const finished = jobs.filter((job) => job.status === "done");
  const current = live.find((job) => job.status === "active") ?? live.find((job) => job.status === "queued") ?? live.find((job) => job.progress > 0) ?? live[0] ?? stopped[0] ?? finished[0];
  const phase: Phase = live.some((job) => job.status !== "paused")
    ? "running"
    : live.length > 0
      ? "paused"
      : stopped.length > 0
        ? "stopped"
        : finished.length > 0
          ? "done"
          : "empty";
  const items = current?.kind === "song" ? undefined : current?.items;
  return {
    phase,
    current,
    songsDone: items ? items.filter((item) => !isLeft(item)).length : current?.status === "done" ? 1 : 0,
    songsTotal: items ? items.length : current ? 1 : 0,
    failed: jobs.filter((job) => job.status === "failed").length,
    waiting: live.filter((job) => job !== current).length,
    rows: [...live, ...stopped].flatMap((job) => rowsOf(job, job === current)),
    finished,
  };
}

function rowsOf(job: Job, inFront: boolean): Row[] {
  const songs = job.kind === "song" ? [] : (job.items ?? []);
  // Only the songs of the one in front, while it runs or waits; any other is one row.
  if (inFront && isLive(job) && songs.length > 0) {
    return songs.filter(isLeft).map((item) => ({
      key: `${job.id}:${item.index}`,
      job,
      item,
      title: item.title || job.label,
      status: songStatus(job, item),
      progress: item.progress,
      error: item.error,
    }));
  }
  return [{ key: String(job.id), job, title: job.label, status: jobStatus(job), progress: job.progress, error: job.error }];
}

function jobStatus(job: Job): RowStatus {
  switch (job.status) {
    case "active":
      return job.stage === "converting" ? "converting" : "downloading";
    case "paused":
    case "failed":
    case "cancelled":
      return job.status;
    default:
      return "queued";
  }
}

function songStatus(job: Job, item: JobItem): RowStatus {
  if (item.status === "failed") return "failed";
  if (job.status === "paused") return "paused";
  if (item.status !== "active") return "queued";
  // Downloaded, now being converted.
  return item.progress >= 1 ? "converting" : "downloading";
}

/** The bytes the finished ones take. */
export const finishedSize = (finished: readonly Job[]) => finished.reduce((sum, job) => sum + (job.size ?? 0), 0);
