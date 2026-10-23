// The finished and the paused downloads, kept in userData across restarts for
// the Downloads window (host only).

import { readFileSync, writeFileSync } from "node:fs";
import { debounce } from "@pear/sdk/util";
import type { SavedJobs } from "./downloads.ts";
import { isFinished, type Job } from "./jobs.ts";

/** How many finished downloads are kept. */
export const HISTORY_LIMIT = 200;
const SAVE_DELAY_MS = 500;

const NOTHING: SavedJobs = { finished: [], paused: [] };

export class DownloadHistory {
  readonly #file: string;
  #saved: SavedJobs = NOTHING;
  #pending = false;
  readonly #writeLater = debounce(() => this.flush(), SAVE_DELAY_MS);

  constructor(file: string) {
    this.#file = file;
  }

  /** The saved jobs; none when the file is missing or broken. */
  load(): SavedJobs {
    try {
      return parseSaved(JSON.parse(readFileSync(this.#file, "utf8")));
    } catch {
      return NOTHING;
    }
  }

  save(saved: SavedJobs) {
    this.#saved = { finished: saved.finished.slice(0, HISTORY_LIMIT), paused: saved.paused };
    this.#pending = true;
    this.#writeLater();
  }

  /** Writes a pending change now. */
  flush() {
    if (!this.#pending) return;
    this.#writeLater.cancel();
    this.#pending = false;
    writeFileSync(this.#file, JSON.stringify(this.#saved));
  }
}

/** Jobs that were queued or running when the app quit don't come back; paused ones do. */
function parseSaved(saved: unknown): SavedJobs {
  if (typeof saved !== "object" || saved === null) return NOTHING;
  // The first version saved the finished jobs alone, as a list.
  const { finished, paused } = Array.isArray(saved) ? { finished: saved, paused: [] } : (saved as Record<string, unknown>);
  return {
    finished: listOf(finished).filter(isFinished).slice(0, HISTORY_LIMIT),
    paused: listOf(paused).filter((job) => job.status === "paused"),
  };
}

const listOf = (value: unknown): Job[] => (Array.isArray(value) ? value.filter(isJob) : []);

function isJob(value: unknown): value is Job {
  if (typeof value !== "object" || value === null) return false;
  const job = value as Partial<Job>;
  const fields = typeof job.id === "number" && typeof job.label === "string" && typeof job.target === "object";
  return fields && Array.isArray(job.files) && typeof job.status === "string";
}
