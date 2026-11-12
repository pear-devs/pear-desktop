import { describe, expect, test } from "vitest";
import { findLyrics, type LrclibEntry, pickLyrics, unsynced } from "../lyrics.ts";

const entry = (patch: Partial<LrclibEntry>): LrclibEntry => ({
  trackName: "Never Gonna Give You Up",
  artistName: "Rick Astley",
  duration: 213,
  instrumental: false,
  plainLyrics: "We're no strangers to love",
  syncedLyrics: null,
  ...patch,
});
const query = { title: "Never Gonna Give You Up (Remastered)", artist: "Rick Astley", durationSeconds: 214 };

describe("lyrics", () => {
  test("the right song, closest in length; synced lyrics win ties", () => {
    const synced = entry({ syncedLyrics: "[00:18.00] We're no strangers to love" });
    expect(pickLyrics([entry({}), synced], query)).toBe(synced);
    expect(pickLyrics([entry({ duration: 400 })], query)).toBeUndefined();
    expect(pickLyrics([entry({ artistName: "Someone Else" })], query)).toBeUndefined();
  });

  test("LRC without its timestamps", () => {
    expect(unsynced("[ar:Rick]\n[00:18.00] We're no strangers\n[00:20.00]\n[00:21.00][00:40.00] to love")).toBe("We're no strangers\n\nto love");
  });

  test("an exact match first, then a search", async () => {
    const asked: string[] = [];
    const fetch = async (url: string) => {
      asked.push(new URL(url).pathname);
      if (url.includes("/api/get")) return new Response("{}", { status: 404 });
      return Response.json([entry({ syncedLyrics: "[00:18.00] We're no strangers to love", plainLyrics: null })]);
    };
    const lyrics = await findLyrics(query, fetch, new AbortController().signal);
    expect(asked).toEqual(["/api/get", "/api/search"]);
    expect(lyrics).toEqual({ plain: "We're no strangers to love", synced: "[00:18.00] We're no strangers to love" });
  });

  test("nothing for instrumentals", async () => {
    const fetch = async () => Response.json(entry({ instrumental: true }));
    expect(await findLyrics(query, fetch, new AbortController().signal)).toBeUndefined();
  });
});
