// Download speed from samples of bytes received: an average over the last few
// seconds, so one slow or fast chunk doesn't make it jump.

/** How far back the average looks. */
const WINDOW_MS = 3000;

interface Sample {
  at: number;
  bytes: number;
}

export class RateMeter {
  #samples: Sample[] = [];

  /** `bytes` received so far, at `now` (ms). */
  sample(bytes: number, now = Date.now()) {
    this.#samples.push({ at: now, bytes });
    // Keep one sample older than the window, to measure across all of it.
    while (this.#samples.length > 2 && now - this.#samples[1]!.at >= WINDOW_MS) this.#samples.shift();
  }

  /** Bytes per second; undefined until there are two samples apart in time. */
  get speed(): number | undefined {
    const first = this.#samples[0];
    const last = this.#samples.at(-1);
    if (!first || !last || last.at <= first.at) return undefined;
    return Math.max(0, ((last.bytes - first.bytes) * 1000) / (last.at - first.at));
  }

  /** Seconds left for `remaining` bytes at the current speed. */
  eta(remaining: number): number | undefined {
    const speed = this.speed;
    if (!speed) return undefined;
    return Math.ceil(Math.max(0, remaining) / speed);
  }
}
