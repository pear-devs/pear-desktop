// The Downloads popover's chips (views of the downloads) and their order. Pure,
// so it is unit-testable.

import { isFinished, type Job } from "../jobs.ts";

export type View = "all" | "downloading" | "finished" | "failed" | "cancelled";
export const VIEWS: readonly View[] = ["all", "downloading", "finished", "failed", "cancelled"];

export function inView(view: View, job: Pick<Job, "status">) {
  switch (view) {
    case "all":
      return true;
    case "downloading":
      return !isFinished(job);
    case "finished":
      return job.status === "done";
    case "failed":
    case "cancelled":
      return job.status === view;
  }
}

/** How many downloads each chip has. */
export function viewCounts(jobs: readonly Pick<Job, "status">[]): Record<View, number> {
  const counts = { all: 0, downloading: 0, finished: 0, failed: 0, cancelled: 0 };
  for (const view of VIEWS) counts[view] = jobs.filter((job) => inView(view, job)).length;
  return counts;
}

/** Newest first. */
export const newestFirst = <T extends Pick<Job, "addedAt">>(jobs: readonly T[]) => [...jobs].sort((a, b) => b.addedAt - a.addedAt);
