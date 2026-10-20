// The download queue: one job at a time, each tried with the engines in order
// (the built-in one, then yt-dlp), with progress for the UI (host only).

import { errorMessage } from "@pear/sdk/util";
import { type Engine, type EngineJob, type EngineResult, isRecoverable, type Progress } from "./engines/types.ts";
import { type DownloadTarget, overallProgress } from "./ytdlp.ts";

// Engines report many times a second; the UI needs a few updates.
const PROGRESS_INTERVAL_MS = 250;

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
  /** The engine that did (the rest of) the job. */
  engine?: Engine["name"];
}

interface Job {
  id: number;
  label: string;
  target: DownloadTarget;
}

export interface QueueOptions {
  /** The engines for a job, tried in order; read per job, so config changes apply to the next download. */
  engines(jobId: number): Engine[];
  onState(state: QueueState): void;
  onResult(result: JobResult): void;
  log: { warn(...args: unknown[]): void };
}

export class DownloadQueue {
  #options: QueueOptions;
  #pending: Job[] = [];
  #active: { job: Job; state: JobState; cancelled: boolean; abort: AbortController } | undefined;
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
    const abort = new AbortController();
    this.#active = { job, state, cancelled: false, abort };
    this.#emit();
    const result = await this.#run(job, state, abort.signal).catch((error: unknown) => ({
      id: job.id,
      label: job.label,
      files: [],
      error: errorMessage(error),
    }));
    const cancelled = this.#active?.cancelled ?? false;
    this.#active = undefined;
    if (!this.#disposed) this.#options.onResult(cancelled ? { ...result, cancelled, error: "Download cancelled" } : result);
    this.#emit();
    void this.#next();
  }

  /** Tries the engines in order; one that can't do (part of) the job hands it to the next. */
  async #run(job: Job, state: JobState, signal: AbortSignal): Promise<JobResult> {
    const engines = this.#options.engines(job.id);
    const saved: string[] = [];
    let target = job.target;
    for (const [index, engine] of engines.entries()) {
      try {
        const result = await engine.download({ ...job, target }, this.#progress(state), signal);
        return { ...resultOf(job, [...saved, ...result.files], result), engine: engine.name };
      } catch (error) {
        const next = engines[index + 1];
        if (!next || !isRecoverable(error) || signal.aborted) throw error;
        this.#options.log.warn(`${engine.name} couldn't download ${job.label} (${error.message}); trying ${next.name}`);
        saved.push(...error.files);
        if (error.items) target = { ...target, items: error.items };
        state.stage = "starting";
        this.#emit();
      }
    }
    return { id: job.id, label: job.label, files: saved };
  }

  #progress(state: JobState): Progress {
    let lastEmit = 0;
    return {
      item: (index, count, title) => {
        state.item = { index, count, title };
        state.stage = "downloading";
        state.progress = overallProgress(index, count, 0);
        this.#emit();
      },
      download: (fraction) => {
        state.stage = "downloading";
        state.progress = Math.min(1, fraction);
        if (Date.now() - lastEmit < PROGRESS_INTERVAL_MS && fraction < 1) return;
        lastEmit = Date.now();
        this.#emit();
      },
      converting: (fraction) => {
        const started = state.stage !== "converting";
        state.stage = "converting";
        if (fraction !== undefined) state.progress = Math.min(1, fraction);
        if (!started && Date.now() - lastEmit < PROGRESS_INTERVAL_MS) return;
        lastEmit = Date.now();
        this.#emit();
      },
    };
  }
}

function resultOf(job: EngineJob, files: string[], result: EngineResult): JobResult {
  const jobResult: JobResult = { id: job.id, label: job.label, files };
  // Some items failing is still a success while others were saved.
  if (result.error && files.length === 0) jobResult.error = result.error;
  return jobResult;
}
