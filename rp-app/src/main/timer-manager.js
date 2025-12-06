/**
 * Manages NodeJS Timers, ensuring only one timer exists per key.
 */
class TimerManager {
  constructor() {
    this.timers = new Map();
  }

  /**
   * Sets a timer for a given key, clearing any existing timer with the same key.
   * @param {string} key - The unique key for the timer.
   * @param {Function} fn - The function to execute after the delay.
   * @param {number} delay - The delay in milliseconds.
   */
  set(key, fn, delay) {
    this.clear(key);
    this.timers.set(key, setTimeout(fn, delay));
  }

  /**
   * Clears the timer associated with the given key.
   * @param {string} key - The key of the timer to clear.
   */
  clear(key) {
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
  }

  /**
   * Clears all managed timers.
   */
  clearAll() {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}

module.exports = { TimerManager };
