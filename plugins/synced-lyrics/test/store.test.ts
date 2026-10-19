import type { Track } from "@pear/sdk";
import { describe, expect, test, vi } from "vitest";
import { detectScripts, Romanizer } from "../romanize.ts";
import { LyricsStore, type Backend, type Options } from "../page/store.ts";
import type { LyricResult, ProviderId } from "../types.ts";

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
  test("shows the richest result regardless of provider order", async () => {
    const store = new LyricsStore(backend({ lrclib: null, ytmusic: synced, genius: plain }), options);
    store.load(track);
    expect(store.loading).toBe(true);
    await settle();
    expect(store.loading).toBe(false);
    expect(store.shown).toMatchObject({ provider: "ytmusic", synced: true, texts: ["hi"] });
  });

  test("honours the preferred provider and manual picks", async () => {
    const store = new LyricsStore(backend({ lrclib: synced, genius: plain }), { ...options, preferred: "genius" });
    store.load(track);
    await settle();
    expect(store.shown).toMatchObject({ provider: "genius", synced: false, texts: ["hi", "there"] });
    store.pick("lrclib");
    expect(store.shown?.provider).toBe("lrclib");
  });

  test("reports errors and retries a provider", async () => {
    const api = backend({ lrclib: new Error("offline") });
    const store = new LyricsStore(api, options);
    store.load(track);
    await settle();
    expect(store.providers.lrclib).toEqual({ status: "error", message: "offline" });
    expect(store.shown).toBeNull();
    store.retry("lrclib");
    expect(store.providers.lrclib.status).toBe("loading");
    await settle();
    expect(api.search).toHaveBeenCalledTimes(4);
  });

  test("ignores results of a previous track", async () => {
    const pending: ((result: LyricResult) => void)[] = [];
    const api = backend({});
    api.search = vi.fn((provider: ProviderId) =>
      provider === "lrclib" ? new Promise<LyricResult>((r) => pending.push(r)) : Promise.resolve(null),
    );
    const store = new LyricsStore(api, options);
    store.load(track);
    store.load({ ...track, videoId: "other" });
    pending[0]!(synced);
    await settle();
    expect(store.shown).toBeNull();
  });

  test("romanizes non-Latin lyrics only", async () => {
    const api = backend({ lrclib: { ...synced, lines: [{ startMs: 0, endMs: 1, text: "사랑해" }] } });
    const store = new LyricsStore(api, { ...options, romanize: true });
    store.load(track);
    await settle();
    await settle();
    expect(store.shown?.romanized).toEqual(["r:사랑해"]);

    const latin = backend({ lrclib: synced });
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

  test("romanizes Korean and Chinese without network", async () => {
    const romanizer = new Romanizer("/nonexistent", () => Promise.reject(new Error("no network in tests")));
    const [ko, zh, en] = await romanizer.romanize(["사랑해", "我爱你", "plain English"]);
    expect(ko).toBe("saranghae");
    expect(zh).toBe("wǒ ài nǐ");
    expect(en).toBeNull();
  });
});
