export interface WaitOptions {
  root?: ParentNode;
  timeout?: number;
  signal?: AbortSignal;
}

/** Resolves with the first element matching `selector`, observing the DOM until it appears. */
export function waitForSelector<E extends Element>(selector: string, options: WaitOptions = {}): Promise<E> {
  const root = options.root ?? document;
  const found = root.querySelector<E>(selector);
  if (found) return Promise.resolve(found);

  return new Promise((resolve, reject) => {
    const observer = new MutationObserver(() => {
      const element = root.querySelector<E>(selector);
      if (element) finish(() => resolve(element));
    });
    const timer = options.timeout === undefined
      ? undefined
      : setTimeout(() => finish(() => reject(new Error(`[pear] timed out waiting for ${selector}`))), options.timeout);
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

/** Calls `place` whenever `element` is detached (now, and on any later DOM change). Returns a stop function. */
export function keepMounted(element: Element, place: (element: Element) => void): () => void {
  const ensure = () => {
    if (!element.isConnected) place(element);
  };
  ensure();
  // YTM may re-render or replace whole parts of the page, so watch the document.
  const stop = observe(document, { childList: true, subtree: true }, ensure);
  return () => {
    stop();
    element.remove();
  };
}

/** A MutationObserver; returns its disconnect. */
export function observe(target: Node, options: MutationObserverInit, callback: MutationCallback): () => void {
  const observer = new MutationObserver(callback);
  observer.observe(target, options);
  return () => observer.disconnect();
}
