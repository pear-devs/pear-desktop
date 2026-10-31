import type { Track } from "@pear/sdk";
import { describe, expect, test, vi } from "vitest";
import { detectScripts, Romanizer } from "../romanize.ts";
import { LyricsStore, type Backend, type Options } from "../page/store.ts";
import { PROVIDERS, type LyricResult, type ProviderId } from "../types.ts";

const track: Track = {
  videoId: "abc",
  title: "Song",
  artist: "Artist",
  durationSeconds: 200,
  url: "https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/watch?v=abc",
  mediaType: "audio",
};
const options: Options = { preferred: "auto", inexact: true, romanize: false, chinese: "off" };

const synced: LyricResult = { title: "Song", artists: ["Artist"], lines: [{ startMs: 0, endMs: 1000, text: "hi" }] };
const plain: LyricResult = { title: "Song", artists: ["Artist"], plain: "hi\nthere" };

function backend(results: Partial<Record<ProviderId, LyricResult | null | Error>>): Backend {
  return {
    search: vi.fn(async (provider: ProviderId) => {
      const result = results[provider] ?? null;
      if (result instanceof Error) throw result;
      return result;
    }),
    romanize: vi.fn(async (lines: string[]) => lines.map((line) => (line ? `r:${line}` : null))),
    convertChinese: vi.fn(async (lines: string[]) => lines),
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("LyricsStore", () => {
  test("an inactive store looks lyrics up only once they are wanted, once per track", async () => {
    const api = backend({ YTMusic: synced });
    const store = new LyricsStore(api, options, false);
    store.load(track);
    await settle();
    expect(api.search).not.toHaveBeenCalled();
    store.setActive(true);
    await settle();
    expect(api.search).toHaveBeenCalledTimes(PROVIDERS.length);
    expect(store.shown).toMatchObject({ provider: "YTMusic" });
    store.setActive(false);
    store.setActive(true);
    expect(api.search).toHaveBeenCalledTimes(PROVIDERS.length);
    // The next track waits while inactive.
    store.setActive(false);
    store.load({ ...track, videoId: "def" });
    await settle();
    expect(api.search).toHaveBeenCalledTimes(PROVIDERS.length);
  });

  test("shows the richest result regardless of provider order", async () => {
    const store = new LyricsStore(backend({ LRCLib: null, YTMusic: synced, LyricsGenius: plain }), options);
    store.load(track);
    expect(store.loading).toBe(true);
    await settle();
    expect(store.loading).toBe(false);
    expect(store.shown).toMatchObject({ provider: "YTMusic", synced: true, texts: ["hi"] });
  });

  test("honours the preferred provider and manual picks", async () => {
    const store = new LyricsStore(backend({ LRCLib: synced, LyricsGenius: plain }), { ...options, preferred: "LyricsGenius" });
    store.load(track);
    await settle();
    expect(store.shown).toMatchObject({ provider: "LyricsGenius", synced: false, texts: ["hi", "there"] });
    store.select("LRCLib");
    expect(store.shown?.provider).toBe("LRCLib");
  });

  test("follows the best provider until switched by hand, like pear-desktop's picker", async () => {
    const store = new LyricsStore(backend({ YTMusic: null, LRCLib: synced, LyricsGenius: plain }), options);
    store.load(track);
    // Before any results: the first provider.
    expect(store.selected).toBe("YTMusic");
    expect(store.current.status).toBe("loading");
    await settle();
    expect(store.selected).toBe("LRCLib");

    // The arrows go through every provider, wrapping around, whatever they found.
    store.step(1);
    expect(store.selected).toBe("MusixMatch");
    expect(store.current).toEqual({ status: "done", result: null });
    expect(store.shown).toBeNull();
    store.step(-2);
    expect(store.selected).toBe("YTMusic");
    store.step(-1);
    expect(store.selected).toBe("LyricsGenius");
    expect(store.shown).toMatchObject({ provider: "LyricsGenius", synced: false });

    // A new track follows the best provider again.
    store.load({ ...track, videoId: "next" });
    await settle();
    expect(store.selected).toBe("LRCLib");
  });

  test("a starred provider is always shown for its track, in pear-desktop's storage format", async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
    });
    try {
      const store = new LyricsStore(backend({ YTMusic: synced, LyricsGenius: plain }), options);
      store.load(track);
      await settle();
      expect(store.selected).toBe("YTMusic");
      store.select("LyricsGenius");
      store.toggleStar();
      expect(storage.get("ytmd-sl-starred-abc")).toBe(JSON.stringify({ provider: "LyricsGenius" }));

      store.load({ ...track, videoId: "other" });
      await settle();
      expect(store.selected).toBe("YTMusic");
      store.load(track);
      expect(store.selected).toBe("LyricsGenius");
      await settle();
      expect(store.shown?.provider).toBe("LyricsGenius");

      store.toggleStar();
      expect(storage.has("ytmd-sl-starred-abc")).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("reports errors and retries a provider", async () => {
    const api = backend({ LRCLib: new Error("offline") });
    const store = new LyricsStore(api, options);
    store.load(track);
    await settle();
    expect(store.providers.LRCLib).toEqual({ status: "error", message: "offline" });
    expect(store.shown).toBeNull();
    store.retry("LRCLib");
    expect(store.providers.LRCLib.status).toBe("loading");
    await settle();
    expect(api.search).toHaveBeenCalledTimes(PROVIDERS.length + 1);
  });

  test("ignores results of a previous track", async () => {
    const pending: ((result: LyricResult) => void)[] = [];
    const api = backend({});
    api.search = vi.fn((provider: ProviderId) =>
      provider === "LRCLib" ? new Promise<LyricResult>((r) => pending.push(r)) : Promise.resolve(null),
    );
    const store = new LyricsStore(api, options);
    store.load(track);
    store.load({ ...track, videoId: "other" });
    pending[0]!(synced);
    await settle();
    expect(store.shown).toBeNull();
  });

  test("romanizes non-Latin lyrics only", async () => {
    const api = backend({ LRCLib: { ...synced, lines: [{ startMs: 0, endMs: 1, text: "사랑해" }] } });
    const store = new LyricsStore(api, { ...options, romanize: true });
    store.load(track);
    await settle();
    await settle();
    expect(store.shown?.romanized).toEqual(["r:사랑해"]);

    const latin = backend({ LRCLib: synced });
    const other = new LyricsStore(latin, { ...options, romanize: true });
    other.load(track);
    await settle();
    expect(latin.romanize).not.toHaveBeenCalled();
  });
});

describe("romanization", () => {
  test("detects scripts per song", () => {
    expect(detectScripts(["Hello", "사랑해", "我爱你"])).toEqual([null, "ko", "zh"]);
    // A kanji-only line in a song with kana is Japanese.
    expect(detectScripts(["愛してる", "永遠", "hello"])).toEqual(["ja", "ja", null]);
  });

  test("Thai, Bengali and Hindi, per line, as pear-desktop", async () => {
    expect(detectScripts(["สวัสดี", "আমি তোমায় ভালোবাসি", "मैं तुमसे प्यार करता हूँ", "hello"])).toEqual(["th", "bn", "hi", null]);
    const romanizer = new Romanizer("/nonexistent", () => Promise.reject(new Error("no network in tests")));
    const [th, bn, hi] = await romanizer.romanize(["สวัสดี", "আমি", "प्यार"]);
    expect(th).toMatch(/^[a-z ]+$/);
    expect(bn).toBe("ami");
    expect(hi).toBe("pyara");
  });

  test("romanizes Korean and Chinese without network", async () => {
    const romanizer = new Romanizer("/nonexistent", () => Promise.reject(new Error("no network in tests")));
    const [ko, zh, en] = await romanizer.romanize(["사랑해", "我爱你", "plain English"]);
    expect(ko).toBe("saranghae");
    expect(zh).toBe("wǒ ài nǐ");
    expect(en).toBeNull();
  });
});
