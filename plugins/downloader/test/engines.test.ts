import { describe, expect, test } from "vitest";
import { DownloadQueue, type JobResult } from "../downloads.ts";
import { type Engine, type EngineJob, RecoverableError } from "../engines/types.ts";

/** An engine answering with `run`, remembering what it was asked. */
function fakeEngine(name: Engine["name"], run: (job: EngineJob) => Promise<{ files: string[] }>) {
  const jobs: EngineJob[] = [];
  const engine: Engine = {
    name,
    download: (job) => {
      jobs.push(job);
      return run(job);
    },
  };
  return { engine, jobs };
}

async function runJob(engines: Engine[], target = { videoId: "abc" }) {
  const results: JobResult[] = [];
  const warnings: unknown[][] = [];
  const queue = new DownloadQueue({
    engines: () => engines,
    onState: () => {},
    onResult: (result) => results.push(result),
    log: { warn: (...args) => warnings.push(args) },
  });
  queue.add(target, "Song");
  await expect.poll(() => results).toHaveLength(1);
  return { result: results[0]!, warnings };
}

describe("engine fallback", () => {
  test("the built-in engine's result when it works; yt-dlp isn't asked", async () => {
    const builtIn = fakeEngine("built-in", async () => ({ files: ["/a.mp3"] }));
    const ytDlp = fakeEngine("yt-dlp", async () => ({ files: ["/b.mp3"] }));
    const { result } = await runJob([builtIn.engine, ytDlp.engine]);
    expect(result).toMatchObject({ files: ["/a.mp3"], engine: "built-in" });
    expect(ytDlp.jobs).toHaveLength(0);
  });

  test("what the site refused goes to yt-dlp", async () => {
    const builtIn = fakeEngine("built-in", async () => {
      throw new RecoverableError("the stream answered HTTP 403");
    });
    const ytDlp = fakeEngine("yt-dlp", async () => ({ files: ["/b.mp3"] }));
    const { result, warnings } = await runJob([builtIn.engine, ytDlp.engine]);
    expect(result).toMatchObject({ files: ["/b.mp3"], engine: "yt-dlp" });
    expect(result.error).toBeUndefined();
    expect(String(warnings[0])).toMatch(/HTTP 403.*trying yt-dlp/);
  });

  test("only a playlist's failed songs go to yt-dlp, and both engines' files count", async () => {
    const builtIn = fakeEngine("built-in", async () => {
      throw new RecoverableError("1 of 3 songs failed", { files: ["/1.mp3", "/3.mp3"], items: [2] });
    });
    const ytDlp = fakeEngine("yt-dlp", async () => ({ files: ["/2.mp3"] }));
    const { result } = await runJob([builtIn.engine, ytDlp.engine], { videoId: "", playlistId: "PL1" } as never);
    expect(ytDlp.jobs[0]!.target).toEqual({ videoId: "", playlistId: "PL1", items: [2] });
    expect(result.files).toEqual(["/1.mp3", "/3.mp3", "/2.mp3"]);
  });

  test("other errors fail the job without trying yt-dlp", async () => {
    const builtIn = fakeEngine("built-in", async () => {
      throw new Error("ENOSPC: no space left on device");
    });
    const ytDlp = fakeEngine("yt-dlp", async () => ({ files: ["/b.mp3"] }));
    const { result } = await runJob([builtIn.engine, ytDlp.engine]);
    expect(result.error).toMatch(/ENOSPC/);
    expect(ytDlp.jobs).toHaveLength(0);
  });

  test("the last engine's refusal is the job's error", async () => {
    const ytDlp = fakeEngine("yt-dlp", async () => {
      throw new RecoverableError("Video unavailable");
    });
    const { result } = await runJob([ytDlp.engine]);
    expect(result.error).toBe("Video unavailable");
  });
});
