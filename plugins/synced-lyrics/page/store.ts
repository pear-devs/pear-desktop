// Page-side lyrics state: per-provider results for the current track, which one
// is selected in the picker, and its romanization. Framework-free; the view
// subscribes to it.
//
// Selection works like pear-desktop's: the picker follows the best provider
// (the preferred one when it has lyrics) until the user switches by hand for
// this track, and a starred provider is always shown for its track.

import type { Track } from "@pear/sdk";
import { remoteErrorMessage } from "@pear/sdk/util";
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
  /** The playing track's original-language title and tags, when the page knows them. */
  details?(videoId: string): { alternativeTitle?: string; tags: string[] } | null;
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

// pear-desktop's key and format, so stars carry over.
const starKey = (videoId: string) => `ytmd-sl-starred-${videoId}`;

export class LyricsStore {
  track: Track | null = null;
  providers = initialProviders();
  /** The provider in the picker; kept from track to track. */
  selected: ProviderId;
  /** Whether the user switched provider by hand for this track. */
  manual = false;
  /** The provider always shown for this track. */
  starred: ProviderId | null = null;
  /** The selected provider's lyrics, when it has some. */
  shown: Shown | null = null;

  #options: Options;
  #backend: Backend;
  #listeners = new Set<() => void>();
  #generation = 0;
  #shownKey = "";
  /** Whether lyrics are wanted (the tab is open); searches wait until then. */
  #active: boolean;
  /** The track (by generation) whose searches have started. */
  #searched = -1;

  constructor(backend: Backend, options: Options, active = true) {
    this.#backend = backend;
    this.#options = options;
    this.#active = active;
    this.selected = options.preferred === "auto" ? PROVIDERS[0] : options.preferred;
  }

  subscribe(listener: () => void) {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  }

  get loading() {
    return PROVIDERS.some((id) => this.providers[id].status === "loading");
  }

  /** The selected provider's search. */
  get current(): ProviderState {
    return this.providers[this.selected];
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
    ++this.#generation;
    this.track = track;
    this.providers = initialProviders();
    this.manual = false;
    this.starred = track ? readStar(track.videoId) : null;
    if (this.starred) this.selected = this.starred;
    this.#shownKey = "";
    this.shown = null;
    this.#emit();
    this.#searchAll();
  }

  /** While inactive, a track's lyrics are only looked up once they become wanted. */
  setActive(active: boolean) {
    this.#active = active;
    this.#searchAll();
  }

  #searchAll() {
    const { track } = this;
    if (!this.#active || !track || this.#searched === this.#generation) return;
    this.#searched = this.#generation;
    for (const id of PROVIDERS) void this.#search(id, track, this.#generation);
  }

  retry(provider: ProviderId) {
    if (!this.track) return;
    this.providers = { ...this.providers, [provider]: { status: "loading" } };
    this.#emit();
    void this.#search(provider, this.track, this.#generation);
  }

  /** Switches to a provider by hand (the picker's arrows and dots). */
  select(provider: ProviderId) {
    this.manual = true;
    this.selected = provider;
    this.#update();
  }

  /** Moves the picker by `step` providers, wrapping around. */
  step(step: number) {
    const index = PROVIDERS.indexOf(this.selected);
    this.select(PROVIDERS[(index + step + PROVIDERS.length) % PROVIDERS.length]!);
  }

  /** Stars the selected provider for this track, or unstars it. */
  toggleStar() {
    if (!this.track) return;
    this.starred = this.starred === this.selected ? null : this.selected;
    writeStar(this.track.videoId, this.starred);
    this.#emit();
  }

  /** The provider to follow automatically: the preferred one when it has lyrics, or the richest result. */
  choose(): ProviderId | null {
    const preferred = this.#options.preferred;
    if (preferred !== "auto" && this.#rank(preferred) > 0) return preferred;
    let best: ProviderId | null = null;
    let bestRank = 0;
    for (const id of PROVIDERS) {
      const rank = this.#rank(id);
      if (rank > bestRank) [best, bestRank] = [id, rank];
    }
    return best;
  }

  #rank(provider: ProviderId) {
    const state = this.providers[provider];
    return state.status === "done" ? resultRank(state.result) : 0;
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
    const details = this.#backend.details?.(track.videoId);
    if (details?.alternativeTitle && details.alternativeTitle !== track.title) query.alternativeTitle = details.alternativeTitle;
    if (details?.tags.length) query.tags = details.tags;
    let state: ProviderState;
    try {
      state = { status: "done", result: await this.#backend.search(provider, query) };
    } catch (error) {
      // Searches run in the host; the message is the provider's, without the IPC wrapper.
      state = { status: "error", message: remoteErrorMessage(error) };
    }
    if (generation !== this.#generation) return;
    this.providers = { ...this.providers, [provider]: state };
    this.#update();
  }

  #update() {
    if (this.starred) this.selected = this.starred;
    else if (!this.manual) {
      const auto = this.choose();
      // Only move to something better, so the picker doesn't jump between equals.
      if (auto && (auto === this.#options.preferred || this.#rank(auto) > this.#rank(this.selected))) this.selected = auto;
    }
    const provider = this.selected;
    const state = this.providers[provider];
    const result = state.status === "done" && resultRank(state.result) > 0 ? state.result : null;
    if (!result) {
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

// localStorage can be unavailable (or throw); a forgotten star is harmless.
function readStar(videoId: string): ProviderId | null {
  try {
    const value = JSON.parse(localStorage.getItem(starKey(videoId)) ?? "null") as { provider?: unknown } | null;
    return (PROVIDERS as readonly unknown[]).includes(value?.provider) ? (value!.provider as ProviderId) : null;
  } catch {
    return null;
  }
}

function writeStar(videoId: string, provider: ProviderId | null) {
  try {
    if (provider) localStorage.setItem(starKey(videoId), JSON.stringify({ provider }));
    else localStorage.removeItem(starKey(videoId));
  } catch {}
}
