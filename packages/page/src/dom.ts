import type { WaitForOptions } from "@pear/sdk";

export interface WaitOptions extends WaitForOptions {
  signal?: AbortSignal;
}

/**
 * Resolves with the first element matching `selector`, observing the DOM until it appears.
 * Rejects with the signal's reason once it aborts, even if the element is already there.
 */
export function waitForSelector<E extends Element>(selector: string, options: WaitOptions = {}): Promise<E> {
  // An aborted signal never fires "abort" again: the observer would run forever.
  if (options.signal?.aborted) return Promise.reject(options.signal.reason);
  const root = options.root ?? document;
  const found = root.querySelector<E>(selector);
  if (found) return Promise.resolve(found);

  return new Promise((resolve, reject) => {
    const observer = new MutationObserver(() => {
      const element = root.querySelector<E>(selector);
      if (element) finish(() => resolve(element));
    });
    const onTimeout = () => finish(() => reject(new Error(`[pear] timed out waiting for ${selector}`)));
    const timer = options.timeout === undefined ? undefined : setTimeout(onTimeout, options.timeout);
    const onAbort = () => finish(() => reject(options.signal?.reason));
    function finish(settle: () => void) {
      observer.disconnect();
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      settle();
    }
    options.signal?.addEventListener("abort", onAbort, { once: true });
    // Observe the Document node itself: at document start it has no documentElement yet.
    observer.observe(root as Node, { childList: true, subtree: true });
  });
}

export function domReady(): Promise<void> {
  if (document.readyState !== "loading") return Promise.resolve();
  return new Promise((resolve) => document.addEventListener("DOMContentLoaded", () => resolve(), { once: true }));
}
