import { describe, expect, test } from "vitest";
import { RateMeter } from "../rate.ts";

describe("download speed", () => {
  test("is the average over the last few seconds", () => {
    const meter = new RateMeter();
    meter.sample(0, 0);
    expect(meter.speed).toBeUndefined();
    meter.sample(1000, 1000);
    meter.sample(3000, 2000);
    expect(meter.speed).toBe(1500);
    expect(meter.eta(6000)).toBe(4);
  });

  test("forgets samples older than its window", () => {
    const meter = new RateMeter();
    meter.sample(0, 0);
    meter.sample(100_000, 1000);
    // A stall: the burst at the start no longer counts once it is out of the window.
    for (let at = 2000; at <= 6000; at += 1000) meter.sample(100_000 + at, at);
    expect(meter.speed).toBeCloseTo(1000);
  });

  test("has no time left without a speed", () => {
    const meter = new RateMeter();
    meter.sample(500, 0);
    meter.sample(500, 1000);
    expect(meter.speed).toBe(0);
    expect(meter.eta(100)).toBeUndefined();
  });
});
