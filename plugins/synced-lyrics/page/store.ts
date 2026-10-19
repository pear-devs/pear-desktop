// Page-side lyrics state: per-provider results for the current track, which one
// is shown, and its romanization. Framework-free; the view subscribes to it.

import type { Track } from "@pear/sdk";
import { PROVIDERS, resultRank, type LyricLine, type LyricResult, type ProviderId, type SearchQuery } from "../types.ts";

export type ProviderState =
  | { status: "loading" }
  | { status: "done"; result: LyricResult | null }
  | { status: "error"; message: string };

export interface Options {
  preferred: ProviderId | "auto";
  inexact: boolean;
  romanize: boolean;
  chinese: "off" | "s2t" | "t2s";
}

export interface Backend {
  search(provider: ProviderId, query: SearchQuery): Promise<LyricResult | null>;
  romanize(lines: string[]): Promise<(string | null)[]>;
  convertChinese(lines: string[], mode: "s2t" | "t2s"): Promise<string[]>;
}

export interface Shown {
  provider: ProviderId;
  result: LyricResult;
  /** Synced lines, or plain lines with zero timing. */
  lines: LyricLine[];
  synced: boolean;
  /** Display text per line after script conversion. */
  texts: string[];
  /** Romanization per line (null where not applicable). */
  romanized: (string | null)[];
}

const PICK_KEY = "pear:synced-lyrics:pick:";

export class LyricsStore {
  track: Track | null = null;
  providers = initialProviders();
  /** The user's explicit choice for this track. */
  manual: ProviderId | null = null;
  shown: Shown | null = null;

  #options: Options;
  #backend: Backend;
  #listeners = new Set<() => void>();
  #generation = 0;
  #shownKey = "";

  constructor(backend: Backend, options: Options) {
    this.#backend = backend;
    this.#options = options;
  }

  subscribe(listener: () => void) {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  }

  get loading() {
    return PROVIDERS.some((id) => this.providers[id].status === "loading");
  }

  setOptions(options: Options) {
    const previous = this.#options;
    this.#options = options;
    if (previous.inexact !== options.inexact) return void this.load(this.track, true);
    if (previous.romanize !== options.romanize || previous.chinese !== options.chinese) this.#shownKey = "";
    this.#update();
  }

  load(track: Track | null, force = false) {
    if (!force && track?.videoId === this.track?.videoId) return;
    const generation = ++this.#generation;
    this.track = track;
    this.providers = initialProviders();
    this.manual = track ? readPick(track.videoId) : null;
    this.#shownKey = "";
    this.shown = null;
    this.#emit();
    if (!track) return;
    for (const id of PROVIDERS) void this.#search(id, track, generation);
  }

  retry(provider: ProviderId) {
    if (!this.track) return;
    this.providers = { ...this.providers, [provider]: { status: "loading" } };
    this.#emit();
    void this.#search(provider, this.track, this.#generation);
  }

  pick(provider: ProviderId) {
    if (!this.track) return;
    this.manual = provider;
    writePick(this.track.videoId, provider);
    this.#update();
  }

  /** Which provider is displayed: the user's pick, the preferred one, or the richest result. */
  choose(): ProviderId | null {
    const has = (id: ProviderId) => {
      const state = this.providers[id];
      return state.status === "done" && resultRank(state.result) > 0;
    };
    if (this.manual && has(this.manual)) return this.manual;
    const preferred = this.#options.preferred;
    if (preferred !== "auto" && has(preferred)) return preferred;
    let best: ProviderId | null = null;
    let bestRank = 0;
    for (const id of PROVIDERS) {
      const state = this.providers[id];
      const rank = state.status === "done" ? resultRank(state.result) : 0;
      if (rank > bestRank) [best, bestRank] = [id, rank];
    }
    return best;
  }

  async #search(provider: ProviderId, track: Track, generation: number) {
    const query: SearchQuery = {
      videoId: track.videoId,
      title: track.title,
      artist: track.artist,
      durationSeconds: track.durationSeconds,
      inexact: this.#options.inexact,
    };
    if (track.album) query.album = track.album;
    let state: ProviderState;
    try {
      state = { status: "done", result: await this.#backend.search(provider, query) };
    } catch (error) {
      state = { status: "error", message: error instanceof Error ? error.message : String(error) };
    }
    if (generation !== this.#generation) return;
    this.providers = { ...this.providers, [provider]: state };
    this.#update();
  }

  #update() {
    const provider = this.choose();
    const state = provider ? this.providers[provider] : undefined;
    const result = state?.status === "done" ? state.result : null;
    if (!provider || !result) {
      this.shown = null;
      this.#shownKey = "";
      return this.#emit();
    }
    const key = `${this.track?.videoId}:${provider}`;
    if (key === this.#shownKey) return this.#emit();
    this.#shownKey = key;

    const synced = !!result.lines?.length;
    const lines = synced
      ? result.lines!
      : (result.plain ?? "").split("\n").map((text) => ({ startMs: 0, endMs: 0, text: text.trim() }));
    const texts = lines.map((line) => line.text);
    this.shown = { provider, result, lines, synced, texts, romanized: texts.map(() => null) };
    this.#emit();
    void this.#transform(key, texts);
  }

  async #transform(key: string, original: string[]) {
    const { chinese, romanize } = this.#options;
    try {
      let texts = original;
      if (chinese !== "off") {
        texts = await this.#backend.convertChinese(original, chinese);
        if (key !== this.#shownKey || !this.shown) return;
        this.shown = { ...this.shown, texts };
        this.#emit();
      }
      if (romanize && texts.some((text) => /[^\p{Script=Latin}\p{P}\p{N}\s]/u.test(text))) {
        const romanized = await this.#backend.romanize(texts);
        if (key !== this.#shownKey || !this.shown) return;
        this.shown = { ...this.shown, romanized };
        this.#emit();
      }
    } catch (error) {
      console.warn("[pear:synced-lyrics] romanization failed", error);
    }
  }

  #emit() {
    for (const listener of this.#listeners) listener();
  }
}

function initialProviders(): Record<ProviderId, ProviderState> {
  return Object.fromEntries(PROVIDERS.map((id) => [id, { status: "loading" }])) as Record<ProviderId, ProviderState>;
}

// localStorage can be unavailable (or throw); a forgotten pick is harmless.
function readPick(videoId: string): ProviderId | null {
  try {
    const value = localStorage.getItem(PICK_KEY + videoId);
    return (PROVIDERS as readonly string[]).includes(value ?? "") ? (value as ProviderId) : null;
  } catch {
    return null;
  }
}

function writePick(videoId: string, provider: ProviderId) {
  try {
    localStorage.setItem(PICK_KEY + videoId, provider);
  } catch {}
}
