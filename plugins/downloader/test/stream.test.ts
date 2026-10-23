import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { downloadStream } from "../engines/innertube.ts";

const STREAM = "0123456789";

/** A stream server answering its `range` parameter, remembering what it was asked. */
function fakeStream() {
  const ranges: string[] = [];
  const fetch = async (url: string) => {
    const range = new URL(url).searchParams.get("range")!;
    ranges.push(range);
    const [start, end] = range.split("-").map(Number);
    return new Response(STREAM.slice(start, end! + 1));
  };
  return { fetch, ranges };
}

describe("the built-in engine's stream download", () => {
  let dir = "";
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const download = (path: string, fetch: ReturnType<typeof fakeStream>["fetch"], received: number[]) =>
    downloadStream({
      url: async () => "https://stream.example/audio?id=1",
      refresh: async () => {},
      total: STREAM.length,
      path,
      fetch,
      onBytes: (bytes) => received.push(bytes),
      signal: new AbortController().signal,
    });

  test("continues a part a paused download left, from its size", async () => {
    dir = mkdtempSync(join(tmpdir(), "pear-stream-"));
    const path = join(dir, "song.part");
    writeFileSync(path, STREAM.slice(0, 4));
    const { fetch, ranges } = fakeStream();
    const received: number[] = [];
    await download(path, fetch, received);
    expect(ranges).toEqual(["4-9"]);
    expect(readFileSync(path, "utf8")).toBe(STREAM);
    expect(received[0]).toBe(4);
    expect(received.at(-1)).toBe(STREAM.length);
  });

  test("starts over when there is no part, and asks nothing when the part is whole", async () => {
    dir = mkdtempSync(join(tmpdir(), "pear-stream-"));
    const path = join(dir, "song.part");
    const { fetch, ranges } = fakeStream();
    await download(path, fetch, []);
    expect(ranges).toEqual(["0-9"]);
    await download(path, fetch, []);
    expect(ranges).toEqual(["0-9"]);
    expect(readFileSync(path, "utf8")).toBe(STREAM);
  });
});
