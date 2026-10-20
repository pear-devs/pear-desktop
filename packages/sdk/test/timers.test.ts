import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CleanupStack, timerSet } from "../src/util.ts";

describe("timerSet", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("stop clears pending timeouts and intervals", () => {
    const timers = timerSet();
    const fired = vi.fn();
    timers.setTimeout(fired, 100);
    timers.setInterval(fired, 100);
    timers.stop();
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
    timers.stop();
    expect(clear).not.toHaveBeenCalled();
  });

  test("clearTimeout and clearInterval forget the timer", () => {
    const timers = timerSet();
    const clear = vi.spyOn(globalThis, "clearTimeout");
    timers.clearTimeout(timers.setTimeout(() => {}, 100));
    timers.clearInterval(timers.setInterval(() => {}, 100));
    clear.mockClear();
    timers.stop();
    expect(clear).not.toHaveBeenCalled();
  });

  test("timers set after stop never fire", () => {
    const timers = timerSet();
    const fired = vi.fn();
    timers.stop();
    timers.setTimeout(fired, 100);
    timers.setInterval(fired, 100);
    vi.advanceTimersByTime(1000);
    expect(fired).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("CleanupStack", () => {
  test("run undoes the last registered first", () => {
    const stack = new CleanupStack(() => {});
    const order: number[] = [];
    stack.add(() => order.push(1));
    stack.track(() => order.push(2));
    stack.add(() => order.push(3));
    stack.run();
    expect(order).toEqual([3, 2, 1]);
  });

  test("the same function added twice runs twice", () => {
    const stack = new CleanupStack(() => {});
    const cleanup = vi.fn();
    stack.add(cleanup);
    stack.add(cleanup);
    stack.run();
    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  test("cleanups added after run run at once", () => {
    const stack = new CleanupStack(() => {});
    stack.run();
    const cleanup = vi.fn();
    const unsubscribe = vi.fn();
    stack.add(cleanup);
    const off = stack.track(unsubscribe);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
    off();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(stack.size).toBe(0);
  });

  test("a manual unsubscribe drops its entry and runs once", () => {
    const stack = new CleanupStack(() => {});
    const unsubscribe = vi.fn();
    const off = stack.track(unsubscribe);
    expect(stack.size).toBe(1);
    off();
    off();
    expect(stack.size).toBe(0);
    stack.run();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  test("a failing cleanup is reported and the rest still run", () => {
    const onError = vi.fn();
    const stack = new CleanupStack(onError);
    const after = vi.fn();
    stack.add(after);
    stack.add(() => {
      throw new Error("boom");
    });
    stack.run();
    expect(onError).toHaveBeenCalledOnce();
    expect(after).toHaveBeenCalledOnce();
  });
});
