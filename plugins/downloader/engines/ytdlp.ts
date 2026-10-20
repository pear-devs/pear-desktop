// The yt-dlp engine: runs yt-dlp for a job and reads its progress (host only).

import { type ChildProcess, execFile, spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { ReadyTools } from "../tools.ts";
import { type ArgsOptions, buildArgs, overallProgress, parseDestination, parseLine } from "../ytdlp.ts";
import type { Engine, EngineJob, EngineResult, Progress } from "./types.ts";

export interface YtDlpOptions {
  /** The tools for the next job; may download them first. */
  prepare(signal: AbortSignal): Promise<ReadyTools>;
  /** Called per job, so config changes apply to the next download. */
  argsFor(tools: ReadyTools, jobId: number): Omit<ArgsOptions, "target">;
  /** A cookies file for this job (removed when it ends), if there is a session to share. */
  cookies?(): Promise<{ path: string; dispose(): Promise<void> } | undefined>;
  log: { warn(...args: unknown[]): void };
}

export class YtDlpEngine implements Engine {
  readonly name = "yt-dlp";
  #options: YtDlpOptions;

  constructor(options: YtDlpOptions) {
    this.#options = options;
  }

  async download(job: EngineJob, progress: Progress, signal: AbortSignal): Promise<EngineResult> {
    const tools = await this.#options.prepare(signal);
    const options: ArgsOptions = { ...this.#options.argsFor(tools, job.id), target: job.target };
    await mkdir(options.folder, { recursive: true });
    // Cancelled before yt-dlp started: there is no process to kill, so don't start one.
    if (signal.aborted) return { files: [] };
    const cookies = await this.#options.cookies?.().catch(() => undefined);
    if (cookies) options.cookiesFile = cookies.path;
    try {
      return await this.#spawn(tools, options, progress, signal);
    } finally {
      await cookies?.dispose().catch(() => {});
    }
  }

  async #spawn(tools: ReadyTools, options: ArgsOptions, progress: Progress, signal: AbortSignal): Promise<EngineResult> {
    // Its own process group, so cancelling also stops the ffmpeg it runs.
    const child = spawn(tools.ytDlp, buildArgs(options), { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, detached: !WINDOWS });
    const kill = () => killTree(child);
    signal.addEventListener("abort", kill, { once: true });

    const files: string[] = [];
    const errors: string[] = [];
    const started = new Set<string>();
    let item = { index: 1, count: 1 };
    const onLine = (line: string) => {
      const destination = parseDestination(line);
      if (destination) started.add(destination);
      const event = parseLine(line);
      if (!event) return;
      switch (event.type) {
        case "item":
          item = event;
          return progress.item(event.index, event.count, event.title);
        case "progress":
          return progress.download(overallProgress(item.index, item.count, event.fraction));
        case "convert":
          return progress.converting();
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

    try {
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      });
      // Playlists may have a few unavailable items; that's still a success.
      if (code !== 0 && files.length === 0) return { files, error: errors.at(-1) ?? `yt-dlp exited with code ${code}` };
      return { files };
    } finally {
      signal.removeEventListener("abort", kill);
      if (signal.aborted) await removePartial(started, files);
    }
  }
}

const WINDOWS = process.platform === "win32";

/** Stops yt-dlp and what it started: its process group, or on Windows its process tree. */
export function killTree(child: ChildProcess) {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (WINDOWS) {
    execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }, () => {});
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill();
  }
}

/** What a cancelled yt-dlp leaves: parts, its resume notes, and files it hadn't finished. */
async function removePartial(started: Set<string>, finished: readonly string[]) {
  const unfinished = [...started].filter((file) => !finished.includes(file));
  const leftovers = [...started].flatMap((file) => [`${file}.part`, `${file}.ytdl`]);
  await Promise.all([...unfinished, ...leftovers].map((file) => rm(file, { force: true }).catch(() => {})));
}
