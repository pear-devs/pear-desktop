// Host side: runs providers (no CORS, real User-Agent) and caches results.

import type { LyricResult, ProviderId, SearchQuery } from "../types.ts";
import { genius } from "./genius.ts";
import type { Fetch } from "./http.ts";
import { lrclib } from "./lrclib.ts";
import { megalobiz } from "./megalobiz.ts";
import { musixmatch, type MusixmatchOptions } from "./musixmatch.ts";
import { ytmusic } from "./ytmusic.ts";

/** Settings and helpers some providers need. */
export interface ProviderOptions {
  musixmatch: MusixmatchOptions;
}

export type Provider = (query: SearchQuery, fetch: Fetch, options: ProviderOptions) => Promise<LyricResult | null>;

export const providers: Record<ProviderId, Provider> = {
  LRCLib: lrclib,
  YTMusic: ytmusic,
  MusixMatch: (query, fetch, options) => musixmatch(query, fetch, options.musixmatch),
  Megalobiz: megalobiz,
  LyricsGenius: genius,
};

const CACHE_SIZE = 500;

/** LRU of finished searches; failures are not cached so they can be retried. */
export class SearchCache {
  #entries = new Map<string, Promise<LyricResult | null>>();

  get(provider: ProviderId, query: SearchQuery, run: () => Promise<LyricResult | null>) {
    const key = `${provider}\n${query.videoId}\n${query.inexact}`;
    const hit = this.#entries.get(key);
    if (hit) {
      this.#entries.delete(key);
      this.#entries.set(key, hit);
      return hit;
    }
    const pending = run();
    this.#entries.set(key, pending);
    pending.catch(() => this.#entries.delete(key));
    while (this.#entries.size > CACHE_SIZE) this.#entries.delete(this.#entries.keys().next().value!);
    return pending;
  }
}
