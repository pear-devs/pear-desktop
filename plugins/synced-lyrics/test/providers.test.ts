import { describe, expect, test } from "vitest";
import { artistSimilarity, jaroWinkler, titleSimilarity } from "../match.ts";
import { extractLyrics } from "../providers/genius.ts";
import { SearchCache } from "../providers/index.ts";
import { lrclib } from "../providers/lrclib.ts";
import { megalobiz, pickSheet, sheetToResult } from "../providers/megalobiz.ts";
import { isUsableToken, musixmatch, parseMacro, resetMusixmatchToken } from "../providers/musixmatch.ts";
import { ytmusic } from "../providers/ytmusic.ts";
import type { SearchQuery } from "../types.ts";
// Recorded from the real APIs (October 2026), lyrics cut to a few lines.
import megalobizLrc from "./fixtures/megalobiz-lrc.json" with { type: "json" };
import megalobizSearch from "./fixtures/megalobiz-search.json" with { type: "json" };
import musixmatchDecoy from "./fixtures/musixmatch-macro-decoy.json" with { type: "json" };
import musixmatchToken from "./fixtures/musixmatch-token-anonymous.json" with { type: "json" };

const query: SearchQuery = {
  videoId: "dQw4w9WgXcQ",
  title: "Never Gonna Give You Up",
  artist: "Rick Astley",
  durationSeconds: 213,
  inexact: true,
};

function mockFetch(routes: [RegExp, unknown][]) {
  const calls: string[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    const route = routes.find(([pattern]) => pattern.test(url));
    if (!route) return new Response("not found", { status: 404 });
    const body = route[1];
    return new Response(typeof body === "string" ? body : JSON.stringify(body));
  };
  return Object.assign(fetch, { calls });
}

const entry = (overrides: object) => ({
  id: 1,
  trackName: "Never Gonna Give You Up",
  artistName: "Rick Astley",
  duration: 213,
  instrumental: false,
  plainLyrics: "plain",
  syncedLyrics: null,
  ...overrides,
});

describe("original-language title and tags, as pear-desktop", () => {
  test("LRCLIB searches the original title and accepts an artist named by a tag", async () => {
    const japanese = { ...query, title: "Pretender", artist: "Higedan", alternativeTitle: "プリテンダー", tags: ["Official髭男dism"], durationSeconds: 326 };
    const fetch = mockFetch([
      [/q=%E3%83%97/, [entry({ trackName: "プリテンダー", artistName: "Official髭男dism", duration: 326, syncedLyrics: "[00:01.00]hello" })]],
      [/search/, []],
    ]);
    const result = await lrclib(japanese, fetch);
    expect(result?.lines?.map((line) => line.text)).toContain("hello");
    expect(fetch.calls.some((call) => call.includes("q=%E3%83%97"))).toBe(true);
    // Without the tag, the artist doesn't match.
    expect(await lrclib({ ...japanese, tags: [] }, fetch)).toBeNull();
  });
});

describe("match", () => {
  test("jaro-winkler", () => {
    expect(jaroWinkler("martha", "marhta")).toBeCloseTo(0.961, 3);
    expect(jaroWinkler("", "a")).toBe(0);
  });
  test("titles ignore bracketed extras", () => {
    expect(titleSimilarity("Never Gonna Give You Up (Official Video)", "Never Gonna Give You Up")).toBe(1);
    expect(titleSimilarity("Paradise", "Never Gonna Give You Up")).toBeLessThan(0.7);
  });
  test("artists compare across collaborators", () => {
    expect(artistSimilarity("Rick Astley, Rick Astley", "Rick Astley")).toBe(1);
    expect(artistSimilarity("Daft Punk & Pharrell Williams", "Pharrell Williams")).toBe(1);
    expect(artistSimilarity("Drake", "Uriah Heep")).toBeLessThan(0.7);
  });
});

describe("lrclib", () => {
  test("prefers synced lyrics with the closest duration by the right artist", async () => {
    const fetch = mockFetch([
      [
        /lrclib\.net\/api\/search/,
        [
          entry({ id: 1, artistName: "Some Cover Band", syncedLyrics: "[00:01.00]wrong artist" }),
          entry({ id: 2, duration: 260, syncedLyrics: "[00:01.00]wrong length" }),
          entry({ id: 3, duration: 212 }),
          entry({ id: 4, duration: 214, syncedLyrics: "[00:19.32]We're no strangers to love\n[00:23.21]You know the rules" }),
        ],
      ],
    ]);
    const result = await lrclib(query, fetch);
    expect(result?.lines?.map((l) => l.text)).toEqual(["", "We're no strangers to love", "You know the rules"]);
    expect(result?.plain).toBe("plain");
    expect(fetch.calls[0]).toContain("track_name=Never+Gonna+Give+You+Up");
  });

  test("returns null for instrumentals and when nothing matches", async () => {
    expect(await lrclib(query, mockFetch([[/search/, [entry({ instrumental: true })]]]))).toBeNull();
    expect(await lrclib(query, mockFetch([[/search/, []]]))).toBeNull();
  });

  test("uses word timing from the lyricsfile", async () => {
    const lyricsfile = "lines:\n- text: Never gonna\n  start_ms: 1000\n  end_ms: 2000\n  words:\n  - text: Never\n    start_ms: 1000\n  - text: gonna\n    start_ms: 1500\n";
    const result = await lrclib(
      query,
      mockFetch([[/search/, [entry({ hasWordSync: true, lyricsfile, syncedLyrics: "[00:01.00]Never gonna" })]]]),
    );
    expect(result?.lines?.[1]?.words?.map((w) => [w.text, w.startMs, w.endMs])).toEqual([
      ["Never ", 1000, 1500],
      ["gonna", 1500, 2000],
    ]);
  });

  test("propagates HTTP errors", async () => {
    await expect(lrclib(query, async () => new Response("", { status: 500 }))).rejects.toThrow(/500/);
  });
});

describe("ytmusic", () => {
  const next = {
    contents: {
      tabs: [
        {
          tabRenderer: {
            endpoint: {
              browseEndpoint: {
                browseId: "MPLYt_test",
                browseEndpointContextSupportedConfigs: {
                  browseEndpointContextMusicConfig: { pageType: "MUSIC_PAGE_TYPE_TRACK_LYRICS" },
                },
              },
            },
          },
        },
      ],
    },
  };
  const timed = (lines: object[]) => ({
    contents: {
      elementRenderer: {
        newElement: { type: { componentType: { model: { timedLyricsModel: { lyricsData: { timedLyricsData: lines } } } } } },
      },
    },
  });

  test("reads timed lyrics", async () => {
    const result = await ytmusic(
      query,
      mockFetch([
        [/\/next/, next],
        [
          /\/browse/,
          timed([
            { lyricLine: "One", cueRange: { startTimeMilliseconds: "1000", endTimeMilliseconds: "2000" } },
            { lyricLine: "♪", cueRange: { startTimeMilliseconds: "2000", endTimeMilliseconds: "4000" } },
          ]),
        ],
      ]),
    );
    expect(result?.lines?.map((l) => [l.startMs, l.endMs, l.text])).toEqual([
      [0, 1000, ""],
      [1000, 2000, "One"],
      [2000, 4000, ""],
    ]);
  });

  test("falls back to plain lines without cue ranges", async () => {
    const result = await ytmusic(
      query,
      mockFetch([
        [/\/next/, next],
        [/\/browse/, timed([{ lyricLine: "One" }, { lyricLine: "Two" }])],
      ]),
    );
    expect(result).toMatchObject({ plain: "One\nTwo" });
    expect(result?.lines).toBeUndefined();
  });

  test("returns null without a lyrics tab", async () => {
    expect(await ytmusic(query, mockFetch([[/\/next/, { contents: {} }]]))).toBeNull();
  });
});

describe("genius", () => {
  test("extracts lyrics from the preloaded state", () => {
    const page = `<script>window.__PRELOADED_STATE__ = JSON.parse('{\\"body\\":{\\"html\\":\\"<p>[Chorus]<br>\\\\nNever &amp; ever<\\\\/p>\\",\\"children\\":[]}}');</script>`;
    expect(extractLyrics(page)).toBe("[Chorus]\nNever & ever");
  });
});

describe("SearchCache", () => {
  test("reuses results and forgets failures", async () => {
    const cache = new SearchCache();
    let runs = 0;
    const ok = () => (runs++, Promise.resolve({ title: "t", artists: [], plain: "x" }));
    await cache.get("LRCLib", query, ok);
    await cache.get("LRCLib", query, ok);
    expect(runs).toBe(1);

    const failing = () => (runs++, Promise.reject(new Error("offline")));
    await expect(cache.get("LyricsGenius", query, failing)).rejects.toThrow();
    await expect(cache.get("LyricsGenius", query, failing)).rejects.toThrow();
    expect(runs).toBe(3);
  });
});

const yellow: SearchQuery = { videoId: "yKNxeF4KMsY", title: "Yellow", artist: "Coldplay", durationSeconds: 269, inexact: false };

describe("megalobiz", () => {
  test("picks the sheet closest in duration and reads its lines", async () => {
    const fetch = mockFetch([
      [/\/v1\/search\?/, megalobizSearch],
      [/\/v1\/lrc\/8510$/, megalobizLrc],
    ]);
    const result = await megalobiz(yellow, fetch);
    expect(fetch.calls[0]).toContain("title=Yellow&artist=Coldplay&duration=269");
    expect(result).toMatchObject({ title: "Yellow", artists: ["Coldplay"], url: "https://megalobiz.com/lrc/8510/yellow" });
    expect(result?.lines?.slice(0, 3).map((l) => [l.startMs, l.endMs, l.text])).toEqual([
      [0, 33240, ""],
      [33240, 36010, "Look at the stars"],
      [36010, 41500, "Look how they shine for you"],
    ]);
  });

  test("rejects sheets of other songs or lengths", () => {
    const [sheet] = megalobizSearch.results;
    expect(pickSheet([{ ...sheet!, artist: "Some Cover Band" }], yellow)).toBeUndefined();
    expect(pickSheet([{ ...sheet!, duration: 300 }], yellow)).toBeUndefined();
    expect(pickSheet([{ ...sheet!, title: "Paradise" }], yellow)).toBeUndefined();
    expect(pickSheet(megalobizSearch.results, { ...yellow, durationSeconds: 271 })?.id).toBe(72486);
  });

  test("falls back to the LRC text", () => {
    const { lines: _, ...lrcOnly } = megalobizLrc;
    expect(sheetToResult(lrcOnly)?.lines?.[1]).toMatchObject({ startMs: 33240, text: "Look at the stars" });
    expect(sheetToResult({ ...lrcOnly, lrc: "[ar:Coldplay]" })).toBeNull();
  });

  test("returns null when nothing matches", async () => {
    expect(await megalobiz(yellow, mockFetch([[/search/, { count: 0, results: [] }]]))).toBeNull();
  });
});

describe("musixmatch", () => {
  const options = { userToken: "", t: (_key: string, english = "") => english };

  test("refuses the all-zero token Musixmatch gives anonymous apps", async () => {
    resetMusixmatchToken();
    expect(isUsableToken(musixmatchToken.message.body.user_token)).toBe(false);
    const fetch = mockFetch([[/token\.get/, musixmatchToken]]);
    await expect(musixmatch(yellow, fetch, options)).rejects.toThrow(/user token/);
    // The refusal is remembered for a while instead of asking again for every track.
    await expect(musixmatch(yellow, fetch, options)).rejects.toThrow(/user token/);
    expect(fetch.calls.filter((call) => call.includes("token.get"))).toHaveLength(1);
    expect(fetch.calls.some((call) => call.includes("macro.subtitles.get"))).toBe(false);
  });

  test("rejects the decoy track it matches with that token", () => {
    // Asked for Coldplay's Yellow, it "found" another song with made-up lyrics.
    const decoy = musixmatchDecoy.message.body.macro_calls["matcher.track.get"].message.body.track;
    expect([decoy.track_name, decoy.artist_name]).toEqual(["NOKIA", "Drake"]);
    expect(parseMacro(musixmatchDecoy, yellow)).toBeNull();
  });

  test("reads the lyrics and LRC of the matched track with the user's token", async () => {
    const answer = structuredClone(musixmatchDecoy) as Record<string, any>;
    const calls = answer.message.body.macro_calls;
    Object.assign(calls["matcher.track.get"].message.body.track, { track_name: "Yellow", artist_name: "Coldplay" });
    calls["track.lyrics.get"].message.body.lyrics.lyrics_body =
      "Look at the stars\nLook how they shine\n\n******* This Lyrics is NOT for Commercial use *******\n(1409623456789)";
    calls["track.subtitles.get"].message.body.subtitle_list[0].subtitle.subtitle_body = "[00:33.24] Look at the stars\n[00:36.01] Look how they shine";
    const fetch = mockFetch([[/macro\.subtitles\.get/, answer]]);

    const result = await musixmatch(yellow, fetch, { ...options, userToken: "2501abc" });
    expect(fetch.calls).toHaveLength(1);
    expect(fetch.calls[0]).toContain("usertoken=2501abc");
    expect(fetch.calls[0]).toContain("q_track=Yellow&q_artist=Coldplay&q_duration=269");
    expect(result).toMatchObject({ title: "Yellow", artists: ["Coldplay"], plain: "Look at the stars\nLook how they shine" });
    expect(result?.lines?.map((l) => l.text)).toEqual(["", "Look at the stars", "Look how they shine"]);
  });

  test("tells when the token is rejected", async () => {
    const fetch = mockFetch([[/macro/, { message: { header: { status_code: 401, hint: "captcha" }, body: "" } }]]);
    await expect(musixmatch(yellow, fetch, { ...options, userToken: "2501abc" })).rejects.toThrow(/rejected/);
  });

  test("handles calls without results", () => {
    const empty = { message: { header: { status_code: 200 }, body: { macro_calls: { "matcher.track.get": { message: { body: [] } } } } } };
    expect(parseMacro(empty, yellow)).toBeNull();
  });
});
