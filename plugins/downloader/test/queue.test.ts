import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { DownloadQueue, type JobResult, type QueueOptions, type SavedJobs } from "../downloads.ts";
import type { Job } from "../jobs.ts";
import { type Engine, type EngineJob, isPause } from "../engines/types.ts";
import { DownloadHistory, HISTORY_LIMIT } from "../history.ts";

/** An engine whose downloads finish when the test says, or when they are aborted. */
function heldEngine() {
  const running: { resolve(files: string[]): void; reject(error: Error): void }[] = [];
  const engine: Engine = {
    name: "built-in",
    download: (_job, _progress, signal) =>
      new Promise((resolve, reject) => {
        running.push({ resolve: (files) => resolve({ files }), reject });
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  };
  /** Finishes the oldest running download. */
  const finish = (files: string[] = ["/song.mp3"]) => running.shift()!.resolve(files);
  const fail = (message: string) => running.shift()!.reject(new Error(message));
  return { engine, finish, fail, running };
}

function queueWith(engine: Engine, options: Partial<QueueOptions> = {}) {
  const results: JobResult[] = [];
  const finished: Job[][] = [];
  const saved: SavedJobs[] = [];
  const queue = new DownloadQueue({
    engines: () => [engine],
    onState: () => {},
    onResult: (result) => results.push(result),
    onSaved: (jobs) => {
      saved.push(jobs);
      finished.push(jobs.finished);
    },
    log: { warn: () => {} },
    ...options,
  });
  return { queue, results, finished, saved };
}

const statuses = (queue: DownloadQueue) => queue.jobs.map((job) => [job.label, job.status]);

describe("download queue", () => {
  test("remembers the songs a job kept in the app, until they are exported", async () => {
    const keeping: Engine = { name: "built-in", download: async () => ({ files: [], kept: ["aaaaaaaaaaa"] }) };
    const { queue, results } = queueWith(keeping);
    const id = queue.add({ videoId: "aaaaaaaaaaa" }, "One");
    await expect.poll(() => queue.jobs[0]?.status).toBe("done");
    expect(queue.jobs[0]).toMatchObject({ files: [], kept: ["aaaaaaaaaaa"] });
    expect(results[0]).toMatchObject({ kept: ["aaaaaaaaaaa"] });
    expect(results[0]?.error).toBeUndefined();

    queue.exported(id, "aaaaaaaaaaa", "/music/One.mp3");
    expect(queue.jobs[0]).toMatchObject({ files: ["/music/One.mp3"] });
    expect(queue.jobs[0]?.kept).toBeUndefined();
  });

  test("lists the running job, the queued ones, then the finished ones", async () => {
    const { engine, finish, running } = heldEngine();
    const { queue } = queueWith(engine);
    queue.add({ videoId: "aaaaaaaaaaa" }, "One");
    queue.add({ videoId: "", playlistId: "OLAK5uy_album" }, "Album");
    queue.add({ videoId: "", playlistId: "PLlist" }, "Playlist");
    await expect.poll(() => running.length).toBe(1);
    expect(queue.jobs.map((job) => [job.label, job.kind, job.status])).toEqual([
      ["One", "song", "active"],
      ["Album", "album", "queued"],
      ["Playlist", "playlist", "queued"],
    ]);
    finish();
    await expect.poll(() => queue.jobs[0]!.status).toBe("active");
    const [album, , done] = queue.jobs;
    expect(album).toMatchObject({ label: "Album", stage: "starting", progress: 0 });
    expect(done).toMatchObject({ label: "One", status: "done", files: ["/song.mp3"], engine: "built-in" });
    expect(done!.finishedAt).toBeGreaterThanOrEqual(done!.addedAt);
    expect(done).not.toHaveProperty("stage");
  });

  test("cancel drops a queued job and stops the running one", async () => {
    const { engine, running } = heldEngine();
    const { queue, results } = queueWith(engine);
    const first = queue.add({ videoId: "aaaaaaaaaaa" }, "One");
    const second = queue.add({ videoId: "bbbbbbbbbbb" }, "Two");
    await expect.poll(() => running.length).toBe(1);
    queue.cancel(second);
    expect(statuses(queue)).toEqual([["One", "active"]]);
    queue.cancel(first);
    await expect.poll(() => statuses(queue)).toEqual([["One", "cancelled"]]);
    expect(results).toEqual([expect.objectContaining({ id: first, cancelled: true })]);
  });

  test("cancelAll stops everything", async () => {
    const { engine, running } = heldEngine();
    const { queue } = queueWith(engine);
    queue.add({ videoId: "aaaaaaaaaaa" }, "One");
    queue.add({ videoId: "bbbbbbbbbbb" }, "Two");
    await expect.poll(() => running.length).toBe(1);
    queue.cancelAll();
    await expect.poll(() => statuses(queue)).toEqual([["One", "cancelled"]]);
  });

  test("retry queues a failed job again, under the same id", async () => {
    const { engine, fail, finish, running } = heldEngine();
    const { queue } = queueWith(engine);
    const id = queue.add({ videoId: "aaaaaaaaaaa" }, "One");
    await expect.poll(() => running.length).toBe(1);
    fail("HTTP 403");
    await expect.poll(() => queue.jobs[0]).toMatchObject({ status: "failed", error: "HTTP 403" });
    queue.retry(id);
    await expect.poll(() => running.length).toBe(1);
    expect(queue.jobs).toEqual([expect.objectContaining({ id, status: "active" })]);
    expect(queue.jobs[0]).not.toHaveProperty("error");
    finish();
    await expect.poll(() => statuses(queue)).toEqual([["One", "done"]]);
  });

  test("remove and clearFinished take jobs off the list", async () => {
    const { engine, finish, running } = heldEngine();
    const { queue, finished } = queueWith(engine);
    const first = queue.add({ videoId: "aaaaaaaaaaa" }, "One");
    await expect.poll(() => running.length).toBe(1);
    finish();
    await expect.poll(() => running.length).toBe(0);
    queue.add({ videoId: "bbbbbbbbbbb" }, "Two");
    await expect.poll(() => running.length).toBe(1);
    finish();
    await expect.poll(() => statuses(queue)).toEqual([["Two", "done"], ["One", "done"]]);
    // A running job stays until it is cancelled.
    const third = queue.add({ videoId: "ccccccccccc" }, "Three");
    await expect.poll(() => running.length).toBe(1);
    queue.remove(third);
    queue.remove(first);
    expect(statuses(queue)).toEqual([["Three", "active"], ["Two", "done"]]);
    queue.clearFinished();
    expect(statuses(queue)).toEqual([["Three", "active"]]);
    expect(finished.at(-1)).toEqual([]);
  });

  test("starts from the finished jobs it is given, with new ids after theirs", async () => {
    const old: Job = { id: 7, target: { videoId: "aaaaaaaaaaa" }, label: "Old", kind: "song", status: "done", progress: 1, files: ["/old.mp3"], addedAt: 1, finishedAt: 2 };
    const { engine } = heldEngine();
    const { queue } = queueWith(engine, { saved: { finished: [old], paused: [] }, keepFinished: 1 });
    expect(queue.add({ videoId: "bbbbbbbbbbb" }, "New")).toBe(8);
    expect(queue.jobs.map((job) => job.id)).toEqual([8, 7]);
  });

  test("keeps only the newest finished jobs", async () => {
    const { engine, finish, running } = heldEngine();
    const { queue } = queueWith(engine, { keepFinished: 1 });
    queue.add({ videoId: "aaaaaaaaaaa" }, "One");
    queue.add({ videoId: "bbbbbbbbbbb" }, "Two");
    await expect.poll(() => running.length).toBe(1);
    finish();
    await expect.poll(() => running.length).toBe(1);
    finish();
    await expect.poll(() => statuses(queue)).toEqual([["Two", "done"]]);
  });
});

/**
 * An engine downloading a three-song playlist into `dir`: each song leaves a
 * part file until the test lets it finish, as the real ones do.
 */
function playlistEngine(dir: string) {
  const asked: EngineJob[] = [];
  let release: (() => void) | undefined;
  const engine: Engine = {
    name: "built-in",
    async download(job, progress, signal) {
      asked.push(job);
      progress.songs([1, 2, 3].map((index) => ({ index, title: `Song ${index}` })));
      const files: string[] = [];
      for (const index of job.target.items ?? [1, 2, 3]) {
        const part = join(dir, `${index}.part`);
        progress.song({ index, status: "active" });
        writeFileSync(part, "half");
        progress.song({ index, bytes: 50, total: 100 });
        try {
          await new Promise<void>((resolve, reject) => {
            release = resolve;
            signal.addEventListener("abort", () => reject(signal.reason));
          });
        } catch (error) {
          if (isPause(signal)) progress.partial(part);
          else rmSync(part);
          throw error;
        }
        rmSync(part);
        const file = join(dir, `${index}.mp3`);
        writeFileSync(file, "song");
        files.push(file);
        progress.song({ index, status: "done", file });
      }
      return { files };
    },
  };
  /** Lets the song being downloaded finish. */
  const next = () => release?.();
  return { engine, asked, next };
}

describe("pausing", () => {
  let dir = "";
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const songStatuses = (queue: DownloadQueue) => queue.jobs[0]!.items!.map((item) => item.status);
  const PLAYLIST = { videoId: "", playlistId: "PLpear" };

  test("keeps the songs it saved and the part it was downloading, then resumes with the rest, also after a restart", async () => {
    dir = mkdtempSync(join(tmpdir(), "pear-pause-"));
    const { engine, asked, next } = playlistEngine(dir);
    const first = queueWith(engine);
    const id = first.queue.add(PLAYLIST, "Playlist");
    await expect.poll(() => songStatuses(first.queue)).toEqual(["active", "queued", "queued"]);
    next();
    await expect.poll(() => songStatuses(first.queue)).toEqual(["done", "active", "queued"]);

    first.queue.pause(id);
    await expect.poll(() => first.queue.jobs[0]?.status).toBe("paused");
    const paused = first.queue.jobs[0]!;
    expect(songStatuses(first.queue)).toEqual(["done", "queued", "queued"]);
    expect(paused.files).toEqual([join(dir, "1.mp3")]);
    expect(paused.partials).toEqual([join(dir, "2.part")]);
    expect(existsSync(join(dir, "2.part"))).toBe(true);
    expect(first.results).toEqual([]);

    // After a restart: the saved jobs, in a new queue.
    const second = queueWith(engine, { saved: first.saved.at(-1)! });
    expect(second.queue.jobs).toEqual([expect.objectContaining({ id, status: "paused" })]);
    second.queue.resume(id);
    await expect.poll(() => asked.length).toBe(2);
    expect(asked[1]!.target).toEqual({ ...PLAYLIST, items: [2, 3] });
    next();
    await expect.poll(() => songStatuses(second.queue)).toEqual(["done", "done", "active"]);
    next();
    await expect.poll(() => second.queue.jobs[0]?.status).toBe("done");
    expect(second.queue.jobs[0]!.files).toEqual([1, 2, 3].map((index) => join(dir, `${index}.mp3`)));
    expect(second.queue.jobs[0]).not.toHaveProperty("partials");
  });

  test("cancelling a paused job removes what it kept", async () => {
    dir = mkdtempSync(join(tmpdir(), "pear-pause-"));
    const { engine } = playlistEngine(dir);
    const { queue } = queueWith(engine);
    const id = queue.add(PLAYLIST, "Playlist");
    await expect.poll(() => songStatuses(queue)).toEqual(["active", "queued", "queued"]);
    queue.pause(id);
    await expect.poll(() => queue.jobs[0]?.status).toBe("paused");
    expect(existsSync(join(dir, "1.part"))).toBe(true);
    queue.cancel(id);
    expect(queue.jobs[0]?.status).toBe("cancelled");
    await expect.poll(() => existsSync(join(dir, "1.part"))).toBe(false);
  });

  test("pauseAll and resumeAll take the queued jobs along", async () => {
    dir = mkdtempSync(join(tmpdir(), "pear-pause-"));
    const { engine } = playlistEngine(dir);
    const { queue } = queueWith(engine);
    queue.add(PLAYLIST, "One");
    queue.add(PLAYLIST, "Two");
    await expect.poll(() => queue.jobs[0]?.status).toBe("active");
    queue.pauseAll();
    await expect.poll(() => statuses(queue)).toEqual([
      ["Two", "paused"],
      ["One", "paused"],
    ]);
    queue.resumeAll();
    await expect.poll(() => statuses(queue)).toEqual([
      ["Two", "active"],
      ["One", "queued"],
    ]);
    queue.cancelAll();
  });

  test("sums the songs' bytes, counting songs not started as the average one", async () => {
    dir = mkdtempSync(join(tmpdir(), "pear-pause-"));
    const { engine } = playlistEngine(dir);
    const { queue } = queueWith(engine);
    queue.add(PLAYLIST, "Playlist");
    await expect.poll(() => queue.jobs[0]?.downloaded).toBe(50);
    expect(queue.jobs[0]).toMatchObject({ size: 300, downloaded: 50 });
    expect(queue.jobs[0]!.items![0]).toMatchObject({ title: "Song 1", size: 100, downloaded: 50, progress: 0.5 });
    queue.cancelAll();
  });
});

describe("download history", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });
  const file = () => {
    dir = mkdtempSync(join(tmpdir(), "pear-history-"));
    return join(dir, "downloads.json");
  };
  const job = (id: number, status: Job["status"]): Job => ({
    id,
    target: { videoId: "aaaaaaaaaaa" },
    label: `Job ${id}`,
    kind: "song",
    status,
    progress: 1,
    files: [],
    addedAt: id,
  });

  test("saves the finished jobs and loads them back", () => {
    const path = file();
    const history = new DownloadHistory(path);
    expect(history.load()).toEqual({ finished: [], paused: [] });
    const saved = { finished: [job(2, "failed"), job(1, "done")], paused: [job(3, "paused")] };
    history.save(saved);
    history.flush();
    expect(new DownloadHistory(path).load()).toEqual(saved);
  });

  test("keeps the newest HISTORY_LIMIT", () => {
    const path = file();
    const history = new DownloadHistory(path);
    history.save({ finished: Array.from({ length: HISTORY_LIMIT + 5 }, (_, i) => job(HISTORY_LIMIT + 5 - i, "done")), paused: [] });
    history.flush();
    const loaded = history.load().finished;
    expect(loaded).toHaveLength(HISTORY_LIMIT);
    expect(loaded[0]!.id).toBe(HISTORY_LIMIT + 5);
  });

  test("drops what was queued or running, and what isn't a job", () => {
    const path = file();
    const finished = [job(4, "active"), job(3, "queued"), job(2, "cancelled"), { id: "x" }, null];
    writeFileSync(path, JSON.stringify({ finished, paused: [job(5, "paused"), job(6, "active")] }));
    expect(new DownloadHistory(path).load()).toEqual({ finished: [job(2, "cancelled")], paused: [job(5, "paused")] });
    // The first version's list of finished jobs.
    writeFileSync(path, JSON.stringify(finished));
    expect(new DownloadHistory(path).load()).toEqual({ finished: [job(2, "cancelled")], paused: [] });
    writeFileSync(path, "not json");
    expect(new DownloadHistory(path).load()).toEqual({ finished: [], paused: [] });
  });

  test("writes later, once", () => {
    const path = file();
    const history = new DownloadHistory(path);
    history.save({ finished: [job(1, "done")], paused: [] });
    history.save({ finished: [job(2, "done"), job(1, "done")], paused: [] });
    expect(() => readFileSync(path)).toThrow();
    history.flush();
    expect(JSON.parse(readFileSync(path, "utf8")).finished).toHaveLength(2);
  });
});
