// appearance.themes: the user's CSS files, read here (the page can't read
// files) and sent to the page, which applies them on top of YTM.
// Files are watched, so editing a theme shows up right away.

import { readFileSync, unwatchFile, watchFile } from "node:fs";

const POLL_MS = 1000;

export class Themes {
  #paths: string[] = [];
  #css: string[] = [];
  #missing: string[] = [];
  #onChange: () => void;

  /** `onChange` runs when a watched file changes. */
  constructor(onChange: () => void) {
    this.#onChange = onChange;
  }

  /** The CSS of the files that could be read, in list order. */
  get css(): string[] {
    return this.#css;
  }

  /** Files in the list that don't exist or can't be read. */
  get missing(): string[] {
    return this.#missing;
  }

  /** Sets the list; reads and watches the files. Returns whether anything changed. */
  set(paths: readonly string[]) {
    const next = [...new Set(paths.map((path) => path.trim()).filter(Boolean))];
    if (next.join("\n") === this.#paths.join("\n")) return false;
    for (const path of this.#paths) if (!next.includes(path)) unwatchFile(path);
    for (const path of next) {
      // Polling survives editors that save by replacing the file.
      if (!this.#paths.includes(path)) watchFile(path, { interval: POLL_MS }, () => this.#reload());
    }
    this.#paths = next;
    return this.#read();
  }

  stop() {
    for (const path of this.#paths) unwatchFile(path);
    this.#paths = [];
  }

  #reload() {
    if (this.#read()) this.#onChange();
  }

  #read() {
    const css: string[] = [];
    const missing: string[] = [];
    for (const path of this.#paths) {
      try {
        css.push(readFileSync(path, "utf8"));
      } catch {
        missing.push(path);
      }
    }
    const changed = css.join("\0") !== this.#css.join("\0") || missing.join("\0") !== this.#missing.join("\0");
    this.#css = css;
    this.#missing = missing;
    return changed;
  }
}
