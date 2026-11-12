// Small helpers plugins and the core kept writing by hand.

import type { Logger } from "./index.ts";
import type { NowPlaying } from "./player.ts";

/** The music service's name and origin, escaped once here (see scripts/escape-names.ts). */
export const YTM_NAME = "\u0059\u006f\u0075\u0054\u0075\u0062\u0065 Music";
export const YTM_ORIGIN = "https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com";

/** An absolute URL on YTM, e.g. `ytmUrl("/watch?v=…")`. */
export const ytmUrl = (path: string) => `${YTM_ORIGIN}${path}`;

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** An error thrown by a host command, without Electron's "Error invoking remote method …: Error:" prefix. */
export function remoteErrorMessage(error: unknown) {
  return errorMessage(error).replace(/^.*Error: /, "");
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  /** Drops a pending call. */
  cancel(): void;
}

/** Calls `fn` once calls stop coming for `ms`. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const debounced = (...args: A) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  return Object.assign(debounced, { cancel: () => clearTimeout(timer) });
}

/** `m:ss`, e.g. 83 → "1:23". */
export function formatDuration(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = String(whole % 60).padStart(2, "0");
  return `${minutes}:${rest}`;
}

/** Playing, or about to (buffering counts: the user didn't pause). */
export function isPlaying(state: Pick<NowPlaying, "status">) {
  return state.status === "playing" || state.status === "buffering";
}

type Timer = ReturnType<typeof setTimeout>;

/**
 * The timers of a running plugin: `stop` clears the pending ones, and timers set
 * after it are cleared at once (a `start` still awaiting when the plugin stopped
 * mustn't leave any behind). Fired and cleared timers are forgotten.
 */
export function timerSet() {
  const pending = new Set<Timer>();
  let stopped = false;
  function arm(timer: Timer) {
    if (stopped) clearTimeout(timer);
    else pending.add(timer);
    return timer;
  }
  return {
    setTimeout(fn: () => void, ms: number): Timer {
      const timer = setTimeout(() => {
        pending.delete(timer);
        fn();
      }, ms);
      return arm(timer);
    },
    setInterval(fn: () => void, ms: number): Timer {
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

/**
 * What a running plugin registered, undone by `run` when it stops, last registered
 * first. Whatever is added after `run` is undone at once: a `start` that was still
 * awaiting when the plugin stopped mustn't leave anything behind.
 */
export class CleanupStack {
  // Wrappers, not the functions themselves: the same function may be added twice.
  readonly #entries = new Set<() => void>();
  readonly #onError: (error: unknown) => void;
  #done = false;

  constructor(onError: (error: unknown) => void) {
    this.#onError = onError;
  }

  get done() {
    return this.#done;
  }

  /** How many cleanups are waiting for `run`. */
  get size() {
    return this.#entries.size;
  }

  /** Runs `cleanup` on `run`, or now if that already happened. */
  add(cleanup: () => void) {
    if (this.#done) return this.#call(cleanup);
    this.#entries.add(() => cleanup());
  }

  /**
   * `add(unsubscribe)`, returning an unsubscribe that also drops it from the
   * stack, so manual unsubscribes don't pile up until the plugin stops. Either
   * way it runs once.
   */
  track(unsubscribe: () => void): () => void {
    let called = false;
    const once = () => {
      if (called) return;
      called = true;
      this.#entries.delete(once);
      unsubscribe();
    };
    if (this.#done) this.#call(once);
    else this.#entries.add(once);
    return once;
  }

  run() {
    if (this.#done) return;
    this.#done = true;
    const entries = [...this.#entries].reverse();
    this.#entries.clear();
    for (const cleanup of entries) this.#call(cleanup);
  }

  #call(cleanup: () => void) {
    try {
      cleanup();
    } catch (error) {
      this.#onError(error);
    }
  }
}

export function createLogger(id: string): Logger {
  const prefix = `[pear:${id}]`;
  return {
    info: (...args) => console.info(prefix, ...args),
    warn: (...args) => console.warn(prefix, ...args),
    error: (...args) => console.error(prefix, ...args),
  };
}
