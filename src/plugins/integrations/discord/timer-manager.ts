import type { TimerKey } from './constants';

/**
 * Manages NodeJS Timers, ensuring only one timer exists per key.
 */
export class TimerManager {
  timers = new Map<TimerKey, NodeJS.Timeout>();

  /**
   * Sets a timer for a given key, clearing any existing timer with the same key.
   * @param key - The unique key for the timer (using TimerKey enum).
   * @param fn - The function to execute after the delay.
   * @param delay - The delay in milliseconds.
   */
  set(key: TimerKey, fn: () => void, delay: number): void {
    this.clear(key);
    this.timers.set(key, setTimeout(fn, delay));
  }

  /**
   * Clears the timer associated with the given key.
   * @param key - The key of the timer to clear (using TimerKey enum).
   */
  clear(key: TimerKey): void {
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
  }

  /**
   * Clears all managed timers.
   */
  clearAll(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}
