import { describe, expect, test } from "vitest";
import { lineAt, parseLrc } from "../lrc.ts";
import { parseLyricsfile } from "../providers/lrclib.ts";

describe("parseLrc", () => {
  test("parses lines, fills end times and adds a leading gap", () => {
    const lines = parseLrc("[ar:Someone]\n[00:12.34] First line\n[00:15.5]Second\n[01:02.003] Third", 70_000);
    expect(lines).toEqual([
      { startMs: 0, endMs: 12_340, text: "" },
      { startMs: 12_340, endMs: 15_500, text: "First line" },
      { startMs: 15_500, endMs: 62_003, text: "Second" },
      { startMs: 62_003, endMs: 70_000, text: "Third" },
    ]);
  });

  test("expands repeated timestamps and sorts", () => {
    const lines = parseLrc("[00:20.00][00:01.00]Chorus\n[00:10.00]Verse");
    expect(lines.map((l) => [l.startMs, l.text])).toEqual([
      [0, ""],
      [1000, "Chorus"],
      [10_000, "Verse"],
      [20_000, "Chorus"],
    ]);
  });

  test("applies [offset:] (positive = earlier)", () => {
    const lines = parseLrc("[offset:+500]\n[00:01.00]a\n[00:02.00]b");
    expect(lines.filter((l) => l.text).map((l) => l.startMs)).toEqual([500, 1500]);
  });

  test("parses enhanced LRC word timing", () => {
    const [, line] = parseLrc("[00:01.00]<00:01.00> Never <00:01.50> gonna <00:02.00> give <00:02.40>\n[00:03.00]next");
    expect(line!.text).toBe("Never gonna give");
    expect(line!.words).toEqual([
      { startMs: 1000, endMs: 1500, text: "Never " },
      { startMs: 1500, endMs: 2000, text: "gonna " },
      { startMs: 2000, endMs: 2400, text: "give" },
    ]);
  });

  test("keeps CJK words unspaced", () => {
    const [, line] = parseLrc("[00:01.00]<00:01.00>私<00:01.30>は<00:01.60>");
    expect(line!.text).toBe("私は");
    expect(line!.words!.map((w) => w.text)).toEqual(["私", "は"]);
  });
});

describe("lineAt", () => {
  const lines = parseLrc("[00:01.00]a\n[00:02.00]b\n[00:03.00]c");
  test("finds the current line", () => {
    expect(lineAt(lines, 0)).toBe(0);
    expect(lineAt(lines, 1999)).toBe(1);
    expect(lineAt(lines, 2000)).toBe(2);
    expect(lineAt(lines, 99_999)).toBe(3);
    expect(lineAt([], 5)).toBe(-1);
  });
});

describe("parseLyricsfile", () => {
  test("reads lines and word timing", () => {
    const lines = parseLyricsfile(
      [
        "version: '1.0'",
        "lines:",
        "- text: Hello there",
        "  start_ms: 1000",
        "  end_ms: 2000",
        "  words:",
        "  - text: Hello",
        "    start_ms: 1000",
        "    end_ms: 1400",
        "  - text: there",
        "    start_ms: 1400",
        "- text: Bye",
        "  start_ms: 2500",
        "  end_ms: 3000",
      ].join("\n"),
    );
    expect(lines).toEqual([
      { startMs: 0, endMs: 1000, text: "" },
      {
        startMs: 1000,
        endMs: 2000,
        text: "Hello there",
        words: [
          { startMs: 1000, endMs: 1400, text: "Hello " },
          { startMs: 1400, endMs: 2000, text: "there" },
        ],
      },
      { startMs: 2500, endMs: 3000, text: "Bye" },
    ]);
  });

  test("returns undefined for empty or broken files", () => {
    expect(parseLyricsfile("lines: []")).toBeUndefined();
    expect(parseLyricsfile("lines: [")).toBeUndefined();
  });
});
