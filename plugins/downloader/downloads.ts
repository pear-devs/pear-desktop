// Runs yt-dlp jobs one after another and reports their progress (host only).

import { type ChildProcess, spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { ReadyTools } from "./tools.ts";
import { buildArgs, type ArgsOptions, type DownloadTarget, overallProgress, parseLine } from "./ytdlp.ts";

export interface JobState {
  id: number;
  label: string;
  /** 0–1 over all items of the job. */
  progress: number;
  stage: "starting" | "downloading" | "converting";
  item?: { index: number; count: number; title: string };
}

export interface QueueState {
  active: JobState | undefined;
  queued: number;
}

export interface JobResult {
  id: number;
  label: string;
  files: string[];
  error?: string;
  cancelled?: boolean;
}

interface Job {
  id: number;
  label: string;
  target: DownloadTarget;
}

export interface QueueOptions {
  /** The tools for the next job; may download them first. */
  prepare(signal: AbortSignal): Promise<ReadyTools>;
  /** Called per job, so config changes apply to the next download. */
  argsFor(tools: ReadyTools, jobId: number): Omit<ArgsOptions, "target">;
  /** A cookies file for this job (removed when it ends), if there is a session to share. */
  cookies?(): Promise<{ path: string; dispose(): Promise<void> } | undefined>;
  onState(state: QueueState): void;
  onResult(result: JobResult): void;
  log: { warn(...args: unknown[]): void };
}

export class DownloadQueue {
  #options: QueueOptions;
  #pending: Job[] = [];
  #active: { job: Job; state: JobState; child: ChildProcess | undefined; cancelled: boolean; abort: AbortController } | undefined;
  #nextId = 1;
  #disposed = false;

  constructor(options: QueueOptions) {
    this.#options = options;
  }

  get state(): QueueState {
    return { active: this.#active && { ...this.#active.state }, queued: this.#pending.length };
  }

  add(target: DownloadTarget, label: string) {
    const job = { id: this.#nextId++, label, target };
    this.#pending.push(job);
    this.#emit();
    void this.#next();
    return job.id;
  }

  /** Stops the running download and drops queued ones. */
  cancel() {
    this.#pending = [];
    if (this.#active) {
      this.#active.cancelled = true;
      this.#active.abort.abort();
      this.#active.child?.kill();
    }
    this.#emit();
  }

  dispose() {
    this.#disposed = true;
    this.cancel();
  }

  #emit() {
    if (!this.#disposed) this.#options.onState(this.state);
  }

  async #next() {
    if (this.#active || this.#disposed) return;
    const job = this.#pending.shift();
    if (!job) return;
    const state: JobState = { id: job.id, label: job.label, progress: 0, stage: "starting" };
    this.#active = { job, state, child: undefined, cancelled: false, abort: new AbortController() };
    this.#emit();
    const result = await this.#run(job, state).catch((error: unknown) => ({
      id: job.id,
      label: job.label,
      files: [],
      error: error instanceof Error ? error.message : String(error),
    }));
    const cancelled = this.#active?.cancelled ?? false;
    this.#active = undefined;
    if (!this.#disposed) this.#options.onResult(cancelled ? { ...result, cancelled, error: "Download cancelled" } : result);
    this.#emit();
    void this.#next();
  }

  async #run(job: Job, state: JobState): Promise<JobResult> {
    const tools = await this.#options.prepare(this.#active!.abort.signal);
    const options: ArgsOptions = { ...this.#options.argsFor(tools, job.id), target: job.target };
    await mkdir(options.folder, { recursive: true });
    // Cancelled before yt-dlp started: there is no process to kill, so don't start one.
    if (this.#active?.cancelled) return { id: job.id, label: job.label, files: [] };
    const cookies = await this.#options.cookies?.().catch(() => undefined);
    if (cookies) options.cookiesFile = cookies.path;
    try {
      return await this.#spawn(job, state, tools, options);
    } finally {
      await cookies?.dispose().catch(() => {});
    }
  }

  async #spawn(job: Job, state: JobState, tools: ReadyTools, options: ArgsOptions): Promise<JobResult> {
    const child = spawn(tools.ytDlp, buildArgs(options), { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    if (this.#active) this.#active.child = child;

    const files: string[] = [];
    const errors: string[] = [];
    let item = { index: 1, count: 1 };
    let lastEmit = 0;
    const onLine = (line: string) => {
      const event = parseLine(line);
      if (!event) return;
      switch (event.type) {
        case "item":
          item = event;
          state.item = event;
          state.stage = "downloading";
          state.progress = overallProgress(event.index, event.count, 0);
          return this.#emit();
        case "progress": {
          state.stage = "downloading";
          state.progress = overallProgress(item.index, item.count, event.fraction);
          // yt-dlp reports many times a second; the UI needs a few updates.
          if (Date.now() - lastEmit < 250 && event.fraction < 1) return;
          lastEmit = Date.now();
          return this.#emit();
        }
        case "convert":
          state.stage = "converting";
          return this.#emit();
        case "done":
          files.push(event.file);
          return;
        case "error":
          errors.push(event.message);
          return;
        case "warning":
          this.#options.log.warn("yt-dlp:", event.message);
          return;
      }
    };
    createInterface({ input: child.stdout }).on("line", onLine);
    createInterface({ input: child.stderr }).on("line", onLine);

    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    const result: JobResult = { id: job.id, label: job.label, files };
    // Playlists may have a few unavailable items; that's still a success.
    if (code !== 0 && files.length === 0) result.error = errors.at(-1) ?? `yt-dlp exited with code ${code}`;
    return result;
  }
}
