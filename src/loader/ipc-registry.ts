// Routes plugin IPC by plugin id and message name. Each process has one
// registry behind a fixed set of Electron channels:
//   plugin:invoke  renderer → main, with a result (handlers live in main)
//   plugin:send    renderer → main
//   plugin:event   main → renderer

type Fn = (...args: unknown[]) => unknown;
/** Any function: handlers and listeners take the arguments their IPC type says. */
type AnyFn = (...args: never[]) => unknown;

export const PLUGIN_INVOKE = 'plugin:invoke';
export const PLUGIN_SEND = 'plugin:send';
export const PLUGIN_EVENT = 'plugin:event';

const keyOf = (id: string, name: string) => `${id}\u0000${name}`;

export class IpcRegistry {
  readonly #handlers = new Map<string, Fn>();
  readonly #listeners = new Map<string, Set<Fn>>();

  /** Answers `invoke(id, name)`; returns the function that removes it. */
  handle(id: string, name: string, handler: AnyFn): () => void {
    const fn = handler as Fn;
    const key = keyOf(id, name);
    if (this.#handlers.has(key)) {
      throw new Error(`[plugins] "${id}" already handles "${name}"`);
    }
    this.#handlers.set(key, fn);
    return () => {
      if (this.#handlers.get(key) === fn) this.#handlers.delete(key);
    };
  }

  /** Listens to `emit(id, name)`; returns the function that removes it. */
  on(id: string, name: string, listener: AnyFn): () => void {
    const fn = listener as Fn;
    const key = keyOf(id, name);
    let set = this.#listeners.get(key);
    if (!set) this.#listeners.set(key, (set = new Set()));
    // Wrapped, so the same function can listen twice and be removed once.
    const entry: Fn = (...args) => fn(...args);
    set.add(entry);
    return () => {
      set.delete(entry);
      if (set.size === 0 && this.#listeners.get(key) === set) {
        this.#listeners.delete(key);
      }
    };
  }

  async invoke(id: string, name: string, args: unknown[]): Promise<unknown> {
    const handler = this.#handlers.get(keyOf(id, name));
    if (!handler) {
      throw new Error(
        `[plugins] "${id}" has no handler for "${name}" (is the plugin enabled?)`,
      );
    }
    return await handler(...args);
  }

  emit(id: string, name: string, args: unknown[]) {
    const set = this.#listeners.get(keyOf(id, name));
    if (!set) return;
    for (const listener of [...set]) {
      try {
        listener(...args);
      } catch (error) {
        console.error(`[plugins] "${id}" listener for "${name}" failed`, error);
      }
    }
  }
}
