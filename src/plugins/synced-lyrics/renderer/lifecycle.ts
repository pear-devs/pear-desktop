// Every asynchronous DOM wait belongs to the current plugin lifetime.
export class LyricsLifecycle {
  readonly controller = new AbortController();
  private cleanups: (() => void)[] = [];
  add(cleanup: () => void) {
    if (this.controller.signal.aborted) cleanup();
    else this.cleanups.push(cleanup);
  }
  dispose() {
    this.controller.abort();
    for (const cleanup of this.cleanups.splice(0).reverse()) cleanup();
  }
}

// Third-party romanizers expose no AbortSignal. Detach their completions when
// Solid disposes/re-runs an effect, rather than writing into an obsolete view.
export const observeLyricsTask = <T>(
  task: Promise<T>,
  commit: (value: T) => void,
) => {
  let active = true;
  task
    .then((value) => {
      if (active) commit(value);
    })
    .catch((error: unknown) => {
      console.error('Lyrics presentation task failed', error);
    });
  return () => {
    active = false;
  };
};

export const waitForLyricsElement = <T extends Element>(
  selector: string,
  signal: AbortSignal,
  root: Document = document,
): Promise<T | null> =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve(null);
      return;
    }
    const found = root.querySelector<T>(selector);
    if (found) {
      resolve(found);
      return;
    }
    const observer = new MutationObserver(() => {
      const element = root.querySelector<T>(selector);
      if (element) finish(element);
    });
    const timeout = setTimeout(() => finish(null), 10000);
    const abort = () => finish(null);
    function finish(element: T | null) {
      observer.disconnect();
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      resolve(element);
    }
    signal.addEventListener('abort', abort, { once: true });
    observer.observe(root.documentElement, { childList: true, subtree: true });
  });
