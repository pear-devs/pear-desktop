export type Cleanup = () => unknown;

/**
 * What a running plugin registered, undone when it stops, last registered
 * first. Whatever is added after the stack ran is undone at once: a `start`
 * still awaiting when its plugin stopped mustn't leave anything behind.
 */
export class CleanupStack {
  // Wrappers, not the functions themselves: the same function may be added twice.
  readonly #entries = new Set<() => unknown>();
  readonly #onError: (error: unknown) => void;
  #done = false;

  constructor(onError: (error: unknown) => void) {
    this.#onError = onError;
  }

  get done() {
    return this.#done;
  }

  /** Registers `fn`; returns a function that unregisters it without running it. */
  add(fn: Cleanup): () => void {
    if (this.#done) {
      this.#call(fn).catch(this.#onError);
      return () => {};
    }
    const entry = () => fn();
    this.#entries.add(entry);
    return () => this.#entries.delete(entry);
  }

  async run() {
    if (this.#done) return;
    this.#done = true;
    const entries = [...this.#entries].reverse();
    this.#entries.clear();
    const pending: Promise<void>[] = [];
    for (const entry of entries) pending.push(this.#call(entry));
    await Promise.all(pending);
  }

  async #call(fn: () => unknown) {
    try {
      await fn();
    } catch (error) {
      this.#onError(error);
    }
  }
}

type Timer = ReturnType<typeof setTimeout>;

/**
 * The timers of a running plugin: `stop` clears the pending ones, and timers
 * set after it are cleared at once. Fired and cleared timers are forgotten.
 */
export function timerSet() {
  const pending = new Set<Timer>();
  let stopped = false;
  const arm = (timer: Timer) => {
    if (stopped) clearTimeout(timer);
    else pending.add(timer);
    return timer;
  };
  return {
    setTimeout(fn: () => void, ms?: number): Timer {
      const timer = setTimeout(() => {
        pending.delete(timer);
        fn();
      }, ms);
      return arm(timer);
    },
    setInterval(fn: () => void, ms?: number): Timer {
      return arm(setInterval(fn, ms));
    },
    clearTimeout(timer: Timer | undefined) {
      if (timer !== undefined) pending.delete(timer);
      clearTimeout(timer);
    },
    clearInterval(timer: Timer | undefined) {
      if (timer !== undefined) pending.delete(timer);
      clearInterval(timer);
    },
    stop() {
      stopped = true;
      // clearTimeout clears intervals too (they share one set of ids).
      for (const timer of pending) clearTimeout(timer);
      pending.clear();
    },
  };
}
