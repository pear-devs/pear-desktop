import { interpolate } from "@pear/sdk/i18n";
import { describe, expect, test } from "vitest";
import { formatBytes, formatSpeed, formatTimeLeft, formatWhen } from "../page/format.ts";
import { inView, newestFirst, viewCounts } from "../page/views.ts";

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

describe("the Downloads popover's chips", () => {
  const job = (label: string, status: "active" | "queued" | "paused" | "done" | "failed" | "cancelled", addedAt: number) => ({ label, status, addedAt });
  const jobs = [job("b", "done", 1), job("A", "active", 3), job("c", "paused", 2), job("d", "failed", 4)];
  const labels = (list: { label: string }[]) => list.map((item) => item.label);

  test("views by status, with their counts", () => {
    expect(labels(jobs.filter((item) => inView("downloading", item)))).toEqual(["A", "c"]);
    expect(labels(jobs.filter((item) => inView("finished", item)))).toEqual(["b"]);
    expect(viewCounts(jobs)).toEqual({ all: 4, downloading: 2, finished: 1, failed: 1, cancelled: 0 });
  });

  test("newest first", () => {
    expect(labels(newestFirst(jobs))).toEqual(["d", "A", "c", "b"]);
  });
});
