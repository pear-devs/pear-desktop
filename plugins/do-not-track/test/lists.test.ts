import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { BUILTIN_SOURCES, cachedSources, chooseLists, fetchSources, parseSources, SOURCES_URL } from "../lists.ts";

const dir = mkdtempSync(join(tmpdir(), "pear-dnt-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("blocklists", () => {
  test("reads tb.json, skipping what isn't a URL", () => {
    expect(parseSources({ tb: ["https://a.example/list.txt", 5, "not a url"] })).toEqual(["https://a.example/list.txt"]);
    expect(parseSources({ tb: [] })).toBeUndefined();
    expect(parseSources({ lists: [] })).toBeUndefined();
    expect(parseSources(null)).toBeUndefined();
  });

  test("combines the curated lists with the user's", () => {
    const sources = ["https://a.example/1.txt", "https://a.example/2.txt"];
    const own = [" https://b.example/mine.txt ", "https://a.example/1.txt", "nonsense"];
    expect(chooseLists(sources, { disableDefaultLists: false, additionalBlockLists: own })).toEqual([
      "https://a.example/1.txt",
      "https://a.example/2.txt",
      "https://b.example/mine.txt",
    ]);
    expect(chooseLists(sources, { disableDefaultLists: true, additionalBlockLists: own })).toEqual([
      "https://b.example/mine.txt",
      "https://a.example/1.txt",
    ]);
    expect(chooseLists(sources, { disableDefaultLists: true, additionalBlockLists: [] })).toEqual([]);
  });

  test("remembers fetched lists and falls back to the built-in copy", async () => {
    expect(await cachedSources(dir)).toBe(BUILTIN_SOURCES);
    const fetched: string[] = [];
    const fetch = async (url: string) => (fetched.push(url), Response.json({ tb: ["https://c.example/new.txt"] }));
    expect(await fetchSources(fetch, dir)).toEqual(["https://c.example/new.txt"]);
    expect(fetched).toEqual([SOURCES_URL]);
    expect(JSON.parse(readFileSync(join(dir, "tb.json"), "utf8"))).toEqual({ tb: ["https://c.example/new.txt"] });
    expect(await cachedSources(dir)).toEqual(["https://c.example/new.txt"]);

    expect(await fetchSources(async () => new Response("down", { status: 503 }), dir)).toBeUndefined();
    expect(await fetchSources(async () => Promise.reject(new Error("offline")), dir)).toBeUndefined();
    expect(await cachedSources(dir)).toEqual(["https://c.example/new.txt"]);
  });
});
