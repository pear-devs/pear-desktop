import type { Unsubscribe } from "@pear/sdk";

type Listener = (...args: any[]) => void;

export class Emitter<Events extends Record<string, Listener>> {
  #listeners = new Map<keyof Events, Set<Listener>>();

  on<K extends keyof Events>(event: K, listener: Events[K]): Unsubscribe {
    const set = this.#listeners.get(event) ?? new Set();
    this.#listeners.set(event, set);
    set.add(listener);
    return () => set.delete(listener);
  }

  emit<K extends keyof Events>(event: K, ...args: Parameters<Events[K]>) {
    for (const listener of this.#listeners.get(event) ?? []) {
      try {
        listener(...args);
      } catch (error) {
        console.error(`[pear] ${String(event)} listener failed`, error);
      }
    }
  }
}
