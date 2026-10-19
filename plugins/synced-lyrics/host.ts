// Host-side state of a running instance: the search cache and the romanizer.

import { join } from "node:path";
import { net } from "electron";
import { providers, SearchCache } from "./providers/index.ts";
import { convertChinese, Romanizer } from "./romanize.ts";
import type { LyricResult, ProviderId, SearchQuery } from "./types.ts";

export class LyricsHost {
  #cache = new SearchCache();
  #romanizer: Romanizer;

  constructor(userData: string) {
    this.#romanizer = new Romanizer(join(userData, "synced-lyrics", "kuromoji"), (url) => net.fetch(url));
  }

  search(provider: ProviderId, query: SearchQuery): Promise<LyricResult | null> {
    const run = providers[provider];
    if (!run) return Promise.reject(new Error(`unknown provider ${provider}`));
    return this.#cache.get(provider, query, () => run(query, (url, init) => net.fetch(url, init)));
  }

  romanize(lines: string[]) {
    return this.#romanizer.romanize(lines);
  }

  convertChinese(lines: string[], mode: "s2t" | "t2s") {
    return convertChinese(lines, mode);
  }
}

/** Keyed by the host context, which is also `this` in commands. */
export const hosts = new WeakMap<object, LyricsHost>();

export function hostOf(ctx: object) {
  const host = hosts.get(ctx);
  if (!host) throw new Error("synced-lyrics is not running");
  return host;
}
