// The download queue: one job at a time, each tried with the engines in order
// (the built-in one, then yt-dlp), with progress for the UI, per song and in
// bytes. Jobs can be paused and resumed (host only).

import { rm } from "node:fs/promises";
import { errorMessage } from "@pear/sdk/util";
import { type Engine, type EngineJob, type EngineResult, isRecoverable, PauseRequest, type Progress, type SongUpdate } from "./engines/types.ts";
import { type Job, type JobItem, kindOf } from "./jobs.ts";
import { RateMeter } from "./rate.ts";
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
  /** Songs kept in the downloader's store instead (video ids). */
  kept?: string[];
  error?: string;
  cancelled?: boolean;
  /** The engine that did (the rest of) the job. */
  engine?: Engine["name"];
  /** What was asked for, to try again. */
  target?: DownloadTarget;
}

/** What outlives the app: the finished jobs, newest first, and the paused ones, to resume. */
export interface SavedJobs {
  finished: Job[];
  paused: Job[];
}

export interface QueueOptions {
  /** The engines for a job, tried in order; read per job, so config changes apply to the next download. */
  engines(jobId: number): Engine[];
  onState(state: QueueState): void;
  onResult(result: JobResult): void;
  /** The finished or the paused jobs changed. */
  onSaved?(saved: SavedJobs): void;
  /** Jobs from before. */
  saved?: SavedJobs;
  /** How many finished jobs it keeps. */
  keepFinished?: number;
  log: { warn(...args: unknown[]): void };
}

interface Running {
  job: Job;
  abort: AbortController;
  /** Why it is being stopped, if it is. */
  stopping?: "cancel" | "pause";
  /** The song being downloaded, for the player-bar button's title. */
  item?: JobState["item"];
}

type Outcome = Pick<Job, "status"> & Partial<Pick<Job, "files" | "kept" | "error" | "engine">>;

export class DownloadQueue {
  #options: QueueOptions;
  #pending: Job[] = [];
  #running: Running | undefined;
  /** In the order they were paused. */
  #paused: Job[];
  /** Newest first. */
  #finished: Job[];
  #nextId: number;
  #disposed = false;

  constructor(options: QueueOptions) {
    this.#options = options;
    this.#finished = options.saved?.finished ?? [];
    this.#paused = options.saved?.paused ?? [];
    // Ids stay unique across restarts, as the saved jobs keep theirs.
    this.#nextId = Math.max(0, ...[...this.#finished, ...this.#paused].map((job) => job.id)) + 1;
  }

  get state(): QueueState {
    return { active: this.#running && jobState(this.#running), queued: this.#pending.length };
  }

  /** Every job: the running one, the queued ones in order, the paused ones, then the finished ones, newest first. */
  get jobs(): Job[] {
    const running = this.#running ? [this.#running.job] : [];
    return [...running, ...this.#pending, ...this.#paused, ...this.#finished].map(snapshot);
  }

  get saved(): SavedJobs {
    return { finished: this.#finished.map(snapshot), paused: this.#paused.map(snapshot) };
  }

  add(target: DownloadTarget, label: string) {
    const job = newJob(this.#nextId++, target, label);
    this.#queue(job);
    return job.id;
  }

  /** Drops a queued job, stops the running one, or gives up a paused one. */
  cancel(id: number) {
    if (this.#running?.job.id === id) return this.#stop("cancel");
    if (this.#dropPending(id)) return this.#emit();
    const paused = this.#takePaused(id);
    if (!paused) return;
    this.#finish(paused, { status: "cancelled" });
    this.#emit();
  }

  /** Stops the running download and drops the queued and paused ones. */
  cancelAll() {
    this.#pending = [];
    const paused = this.#paused;
    this.#paused = [];
    for (const job of paused) this.#finish(job, { status: "cancelled" });
    this.#stop("cancel");
    this.#emit();
  }

  /** Stops a running or queued job, keeping what it downloaded to resume from. */
  pause(id: number) {
    if (this.#running?.job.id === id) return this.#stop("pause");
    const job = this.#pending.find((pending) => pending.id === id);
    if (!job) return;
    this.#dropPending(id);
    this.#toPaused(job);
    this.#emit();
  }

  pauseAll() {
    const pending = this.#pending;
    this.#pending = [];
    for (const job of pending) this.#toPaused(job);
    this.#stop("pause");
    this.#emit();
  }

  /** Queues a paused job again, at the end of the line. */
  resume(id: number) {
    const job = this.#takePaused(id);
    if (job) this.#queue(job);
  }

  resumeAll() {
    const paused = this.#paused;
    this.#paused = [];
    this.#saved();
    for (const job of paused) this.#queue(job);
  }

  /** Queues a finished job's download again. */
  retry(id: number) {
    const job = this.#takeFinished(id);
    if (job) this.#queue(newJob(id, job.target, job.label));
  }

  /** Takes a queued, paused or finished job off the list; a running one has to be stopped first. */
  remove(id: number) {
    const paused = this.#takePaused(id);
    if (paused) void removeFiles(paused.partials);
    if (paused || this.#dropPending(id) || this.#takeFinished(id)) this.#emit();
  }

  /** A kept song of a finished job was exported to `file`. */
  exported(id: number, videoId: string, file: string) {
    const job = this.#finished.find((finished) => finished.id === id);
    if (!job) return;
    job.kept = (job.kept ?? []).filter((kept) => kept !== videoId);
    if (job.kept.length === 0) delete job.kept;
    if (!job.files.includes(file)) job.files = [...job.files, file];
    for (const item of job.items ?? []) if (item.videoId === videoId) item.file = file;
    this.#saved();
    this.#emit();
  }

  clearFinished() {
    if (this.#finished.length === 0) return;
    this.#finished = [];
    this.#saved();
    this.#emit();
  }

  /** The plugin stops: the running and queued jobs end; the paused ones stay saved. */
  dispose() {
    this.#pending = [];
    this.#stop("cancel");
    this.#disposed = true;
  }

  #stop(reason: "cancel" | "pause") {
    const running = this.#running;
    if (!running || running.stopping) return;
    running.stopping = reason;
    running.abort.abort(reason === "pause" ? new PauseRequest() : undefined);
  }

  #queue(job: Job) {
    job.status = "queued";
    this.#pending.push(job);
    this.#emit();
    void this.#next();
  }

  #toPaused(job: Job) {
    job.status = "paused";
    this.#paused.push(job);
    this.#saved();
  }

  #dropPending(id: number) {
    const before = this.#pending.length;
    this.#pending = this.#pending.filter((job) => job.id !== id);
    return this.#pending.length < before;
  }

  #takePaused(id: number) {
    const job = this.#paused.find((paused) => paused.id === id);
    if (!job) return undefined;
    this.#paused = this.#paused.filter((paused) => paused !== job);
    this.#saved();
    return job;
  }

  #takeFinished(id: number) {
    const job = this.#finished.find((finished) => finished.id === id);
    if (!job) return undefined;
    this.#finished = this.#finished.filter((finished) => finished !== job);
    this.#saved();
    return job;
  }

  /** Ends a job; what it kept to resume from goes. */
  #finish(job: Job, outcome: Outcome) {
    void removeFiles(job.partials);
    const { stage: _stage, partials: _partials, ...rest } = job;
    const finished: Job = { ...rest, ...outcome, finishedAt: Date.now() };
    for (const item of finished.items ?? []) stopItem(item);
    stopTransfer(finished);
    this.#finished.unshift(finished);
    this.#finished.splice(this.#options.keepFinished ?? Infinity);
    this.#saved();
  }

  #saved() {
    if (!this.#disposed) this.#options.onSaved?.(this.saved);
  }

  #emit() {
    if (!this.#disposed) this.#options.onState(this.state);
  }

  async #next() {
    if (this.#running || this.#disposed) return;
    const job = this.#pending.shift();
    if (!job) return;
    job.status = "active";
    job.stage = "starting";
    const running: Running = { job, abort: new AbortController() };
    this.#running = running;
    this.#emit();

    let result: JobResult;
    let failed = false;
    try {
      result = await this.#run(running);
    } catch (error) {
      failed = true;
      result = { id: job.id, label: job.label, files: [], error: errorMessage(error) };
    }
    this.#running = undefined;
    if (!this.#disposed) this.#ended(running, result, failed);
    this.#emit();
    void this.#next();
  }

  /** A run is over: the job finished, or is paused if it was stopped for that. */
  #ended({ job, stopping }: Running, result: JobResult, failed: boolean) {
    if (stopping === "pause" && failed) return this.#pausedRun(job);
    const cancelled = stopping === "cancel";
    const final: JobResult = cancelled ? { ...result, cancelled, error: "Download cancelled" } : result;
    const outcome: Outcome = { status: "done", files: final.files };
    if (final.kept?.length) outcome.kept = final.kept;
    if (final.engine) outcome.engine = final.engine;
    if (cancelled) outcome.status = "cancelled";
    else if (final.error) Object.assign(outcome, { status: "failed", error: final.error });
    this.#finish(job, outcome);
    this.#options.onResult({ ...final, target: job.target });
  }

  /** The songs it saved stay saved; the one it was downloading starts again on resume. */
  #pausedRun(job: Job) {
    job.files = savedFiles(job);
    job.kept = keptSongs(job);
    delete job.stage;
    for (const item of job.items ?? []) {
      if (item.status === "active") item.status = "queued";
      stopItem(item);
    }
    stopTransfer(job);
    this.#toPaused(job);
  }

  /** Tries the engines in order; one that can't do (part of) the job hands it to the next. */
  async #run(running: Running): Promise<JobResult> {
    const { job } = running;
    const { signal } = running.abort;
    const engines = this.#options.engines(job.id);
    // A resumed job keeps what it saved before, and does only the songs it hadn't.
    const saved = [...job.files];
    const kept = [...(job.kept ?? [])];
    let target = remainingTarget(job);
    const progress = this.#progress(running);
    for (const [index, engine] of engines.entries()) {
      try {
        const result = await engine.download({ id: job.id, label: job.label, target }, progress, signal);
        return { ...resultOf(job, [...saved, ...result.files], [...kept, ...(result.kept ?? [])], result), engine: engine.name };
      } catch (error) {
        const next = engines[index + 1];
        if (!next || !isRecoverable(error) || signal.aborted) throw error;
        this.#options.log.warn(`${engine.name} couldn't download ${job.label} (${error.message}); trying ${next.name}`);
        saved.push(...error.files);
        kept.push(...error.kept);
        if (error.items) target = { ...target, items: error.items };
        job.stage = "starting";
        this.#emit();
      }
    }
    return { id: job.id, label: job.label, files: saved, kept };
  }

  #progress(running: Running): Progress {
    const { job } = running;
    const meters = new Map<number, RateMeter>();
    let lastEmit = 0;
    /** At most every PROGRESS_INTERVAL_MS, unless something worth showing at once changed. */
    const emit = (now: boolean) => {
      if (!now && Date.now() - lastEmit < PROGRESS_INTERVAL_MS) return;
      lastEmit = Date.now();
      this.#emit();
    };
    return {
      item: (index, count, title) => {
        running.item = { index, count, title };
        job.stage = "downloading";
        job.progress = overallProgress(index, count, 0);
        emit(true);
      },
      download: (fraction) => {
        job.stage = "downloading";
        job.progress = Math.min(1, fraction);
        emit(fraction >= 1);
      },
      converting: (fraction) => {
        const started = job.stage !== "converting";
        job.stage = "converting";
        if (fraction !== undefined) job.progress = Math.min(1, fraction);
        emit(started);
      },
      songs: (songs) => {
        for (const song of songs) {
          const item = itemOf(job, song.index);
          if (song.videoId) item.videoId = song.videoId;
          if (song.title) item.title = song.title;
        }
        emit(true);
      },
      song: (update) => {
        let meter = meters.get(update.index);
        if (!meter) meters.set(update.index, (meter = new RateMeter()));
        const changed = applySong(itemOf(job, update.index), update, meter);
        sumTransfer(job);
        emit(changed);
      },
      partial: (file) => {
        job.partials = [...new Set([...(job.partials ?? []), file])];
      },
    };
  }
}

function newJob(id: number, target: DownloadTarget, label: string): Job {
  return { id, target, label, kind: kindOf(target), status: "queued", progress: 0, files: [], addedAt: Date.now() };
}

/** The job's song at that position, added if the engine hadn't listed it. */
function itemOf(job: Job, index: number): JobItem {
  job.items ??= [];
  const known = job.items.find((item) => item.index === index);
  if (known) return known;
  const item: JobItem = { index, title: "", status: "queued", progress: 0 };
  job.items.push(item);
  job.items.sort((a, b) => a.index - b.index);
  return item;
}

/** Applies an engine's update to a song; whether its status changed (worth showing at once). */
function applySong(item: JobItem, update: SongUpdate, meter: RateMeter) {
  const before = item.status;
  if (update.status) item.status = update.status;
  if (update.videoId) item.videoId = update.videoId;
  if (update.title) item.title = update.title;
  if (update.file) item.file = update.file;
  if (update.error) item.error = update.error;
  if (update.total) item.size = update.total;
  if (update.bytes !== undefined) {
    item.downloaded = update.bytes;
    meter.sample(update.bytes);
    setOrDelete(item, "speed", meter.speed);
    setOrDelete(item, "eta", item.size ? meter.eta(item.size - update.bytes) : undefined);
    if (item.size) item.progress = Math.min(1, update.bytes / item.size);
  }
  if (item.status === "done" || item.status === "skipped") item.progress = 1;
  if (item.status !== "active") stopItem(item);
  return item.status !== before;
}

/** A song that isn't downloading has no speed or time left. */
function stopItem(item: JobItem) {
  delete item.speed;
  delete item.eta;
}

function stopTransfer(job: Job) {
  delete job.speed;
  delete job.eta;
}

/** The job's bytes, speed and time left over its songs; songs not started yet count as the average one. */
function sumTransfer(job: Job) {
  const items = (job.items ?? []).filter((item) => item.status !== "skipped" && item.status !== "failed");
  const sized = items.filter((item) => item.size !== undefined);
  if (sized.length === 0) return;
  const known = sized.reduce((sum, item) => sum + item.size!, 0);
  const size = Math.round(known + (known / sized.length) * (items.length - sized.length));
  const downloaded = items.reduce((sum, item) => sum + (item.downloaded ?? 0), 0);
  const speed = items.reduce((sum, item) => sum + (item.speed ?? 0), 0);
  job.size = size;
  job.downloaded = downloaded;
  setOrDelete(job, "speed", speed || undefined);
  setOrDelete(job, "eta", speed ? Math.ceil(Math.max(0, size - downloaded) / speed) : undefined);
}

function setOrDelete<K extends "speed" | "eta">(target: Partial<Record<K, number>>, key: K, value: number | undefined) {
  if (value === undefined) delete target[key];
  else target[key] = value;
}

/** The songs a job kept in the store so far, and not exported. */
function keptSongs(job: Job) {
  const songs = (job.items ?? []).flatMap((item) => (item.status === "done" && !item.file && item.videoId ? [item.videoId] : []));
  return [...new Set([...(job.kept ?? []), ...songs])];
}

/** The files of the songs a job saved so far. */
function savedFiles(job: Job) {
  const songs = (job.items ?? []).flatMap((item) => (item.status === "done" && item.file ? [item.file] : []));
  return [...new Set([...job.files, ...songs])];
}

/** What is left of a job's target: a resumed album or playlist skips the songs it did. */
function remainingTarget(job: Job): DownloadTarget {
  const items = job.items ?? [];
  const isDone = (item: JobItem) => item.status === "done" || item.status === "skipped";
  if (!job.target.playlistId || !items.some(isDone)) return job.target;
  const left = items.filter((item) => !isDone(item)).map((item) => item.index);
  const wanted = job.target.items;
  return { ...job.target, items: wanted ? left.filter((index) => wanted.includes(index)) : left };
}

function resultOf(job: EngineJob, files: string[], kept: string[], result: EngineResult): JobResult {
  const jobResult: JobResult = { id: job.id, label: job.label, files, kept: [...new Set(kept)] };
  // Some items failing is still a success while others were saved.
  if (result.error && files.length === 0 && kept.length === 0) jobResult.error = result.error;
  return jobResult;
}

/** The running job, as the player-bar button shows it. */
function jobState({ job, item }: Running): JobState {
  const state: JobState = { id: job.id, label: job.label, progress: job.progress, stage: job.stage ?? "starting" };
  if (item) state.item = { ...item };
  return state;
}

/** A copy to hand out; a single song's one item is the job itself. */
function snapshot(job: Job): Job {
  const { items, partials, ...rest } = job;
  const copy: Job = { ...rest, files: [...job.files] };
  if (job.kept) copy.kept = [...job.kept];
  if (partials) copy.partials = [...partials];
  if (items && job.kind !== "song") copy.items = items.map((item) => ({ ...item }));
  return copy;
}

async function removeFiles(files: readonly string[] | undefined) {
  await Promise.all((files ?? []).map((file) => rm(file, { force: true }).catch(() => {})));
}
