import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { timerSet } from "../src/util.ts";

describe("timerSet", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("clearAll clears pending timeouts and intervals", () => {
    const timers = timerSet();
    const fired = vi.fn();
    timers.setTimeout(fired, 100);
    timers.setInterval(fired, 100);
    timers.clearAll();
    vi.advanceTimersByTime(1000);
    expect(fired).not.toHaveBeenCalled();
  });

  test("re-armed timeouts don't pile up", () => {
    const timers = timerSet();
    let ticks = 0;
    const tick = () => {
      ticks++;
      if (ticks < 1000) timers.setTimeout(tick, 1);
    };
    timers.setTimeout(tick, 1);
    vi.advanceTimersByTime(1000);
    expect(ticks).toBe(1000);
    expect(vi.getTimerCount()).toBe(0);
    // Nothing left to clear: every timer fired and was forgotten.
    const clear = vi.spyOn(globalThis, "clearTimeout");
    timers.clearAll();
    expect(clear).not.toHaveBeenCalled();
  });

  test("clearTimeout and clearInterval forget the timer", () => {
    const timers = timerSet();
    const clear = vi.spyOn(globalThis, "clearTimeout");
    timers.clearTimeout(timers.setTimeout(() => {}, 100));
    timers.clearInterval(timers.setInterval(() => {}, 100));
    clear.mockClear();
    timers.clearAll();
    expect(clear).not.toHaveBeenCalled();
  });
});
