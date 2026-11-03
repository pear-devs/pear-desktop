// The items plugins add to the app and tray menus (`ctx.addMenuItem`), in the
// order they were added. The menus are rebuilt when they change.

import type { PluginMenuItem } from "@pear/sdk";

export class MenuItems {
  #items: PluginMenuItem[] = [];
  #listeners = new Set<() => void>();

  get items(): readonly PluginMenuItem[] {
    return this.#items;
  }

  /** Adds an item; returns its removal. */
  add(item: PluginMenuItem) {
    this.#items = [...this.#items, item];
    this.#changed();
    return () => {
      const before = this.#items.length;
      this.#items = this.#items.filter((known) => known !== item);
      if (this.#items.length < before) this.#changed();
    };
  }

  /** Calls `listener` on every change; returns its removal. */
  onChange(listener: () => void) {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  }

  #changed() {
    for (const listener of this.#listeners) listener();
  }
}
