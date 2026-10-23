import { interpolate } from "@pear/sdk/i18n";
import { describe, expect, test } from "vitest";
import { formatBytes, formatSpeed, formatTimeLeft, formatWhen } from "../page/format.ts";
import type { Job, JobItem } from "../jobs.ts";
import { finishedSize, summarize } from "../page/views.ts";

const t = (_key: string, english?: string, vars?: Record<string, unknown>) => interpolate(english ?? "", vars);

describe("the Downloads popover's units", () => {
  test("sizes and speeds in binary units", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(3_445_462)).toBe("3.3 MiB");
    expect(formatBytes(2 * 1024 ** 3)).toBe("2.0 GiB");
    expect(formatSpeed(1536)).toBe("1.5 KiB/s");
  });

  test("time left, in words", () => {
    expect(formatTimeLeft(45, t)).toBe("45 s");
    expect(formatTimeLeft(170, t)).toBe("3 min");
    expect(formatTimeLeft(3900, t)).toBe("1 h 5 min");
  });

  test("when, relative while recent", () => {
    const now = Date.UTC(2026, 9, 21, 12);
    const minutes = (count: number) => now - count * 60_000;
    expect(formatWhen(minutes(5), now)).toMatch(/5/);
    expect(formatWhen(minutes(5), now)).not.toBe(formatWhen(minutes(5 * 60), now));
    expect(formatWhen(minutes(30 * 24 * 60), now)).toMatch(/2026/);
  });
});

describe("the Downloads summary", () => {
  let id = 0;
  const job = (label: string, status: Job["status"], extra: Partial<Job> = {}): Job => ({
    id: ++id,
    target: { videoId: "x" },
    label,
    kind: "song",
    status,
    progress: 0,
    files: [],
    addedAt: id,
    ...extra,
  });
  const item = (index: number, status: JobItem["status"], progress = 0): JobItem => ({ index, title: `song ${index}`, status, progress });
  const album = (status: Job["status"], items: JobItem[]) => job("Album", status, { kind: "album", items, progress: 0.5 });

  test("the album in front: its songs done, and a row per song still to go", () => {
    const summary = summarize([album("active", [item(1, "done", 1), item(2, "active", 0.4), item(3, "active", 1), item(4, "queued")]), job("Next", "queued")]);
    expect(summary).toMatchObject({ phase: "running", songsDone: 1, songsTotal: 4, waiting: 1, failed: 0 });
    expect(summary.current?.label).toBe("Album");
    expect(summary.rows.map((row) => [row.title, row.status])).toEqual([
      ["song 2", "downloading"],
      ["song 3", "converting"],
      ["song 4", "queued"],
      ["Next", "queued"],
    ]);
  });

  test("an album that is not in front is one row, and so is a failed one", () => {
    const summary = summarize([job("Song", "active", { stage: "converting" }), album("queued", [item(1, "queued")]), job("Broken", "failed", { error: "no" })]);
    expect(summary.rows.map((row) => [row.title, row.status, row.item === undefined])).toEqual([
      ["Song", "converting", true],
      ["Album", "queued", true],
      ["Broken", "failed", true],
    ]);
    expect(summary.failed).toBe(1);
  });

  test("phases", () => {
    expect(summarize([]).phase).toBe("empty");
    expect(summarize([job("a", "paused")]).phase).toBe("paused");
    expect(summarize([job("a", "paused"), job("b", "queued")]).phase).toBe("running");
    // Paused all: the one that got somewhere is in front.
    expect(summarize([job("fresh", "paused"), job("started", "paused", { progress: 0.3 })]).current?.label).toBe("started");
    expect(summarize([job("a", "cancelled"), job("b", "done")]).phase).toBe("stopped");
    const done = summarize([job("a", "done", { size: 100 }), job("b", "done", { size: 50 })]);
    expect(done).toMatchObject({ phase: "done", songsDone: 1, songsTotal: 1, rows: [] });
    expect(finishedSize(done.finished)).toBe(150);
  });
});
