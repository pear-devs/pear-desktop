import type { TimerKey } from './constants';

export class TimerManager {
  timers = new Map<TimerKey, NodeJS.Timeout>();

  set(key: TimerKey, fn: () => void, delay: number): void {
    this.clear(key);
    this.timers.set(key, setTimeout(fn, delay));
  }

  clear(key: TimerKey): void {
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
  }

  clearAll(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}
