import { describe, expect, test } from "vitest";
import { cleanSegment, playlistFolder, renderTemplate, type TemplateFields } from "../template.ts";
import { DEFAULT_TEMPLATE } from "../ytdlp.ts";

const song: TemplateFields = { id: "abcdefghijk", title: "Never Gonna Give You Up", ext: "mp3", artist: "Rick Astley" };

describe("renderTemplate", () => {
  test("the default template, with yt-dlp's fallbacks between fields", () => {
    expect(renderTemplate(DEFAULT_TEMPLATE, song, "linux")).toBe("Rick Astley - Never Gonna Give You Up.mp3");
    expect(renderTemplate("", song, "linux")).toBe("Rick Astley - Never Gonna Give You Up.mp3");
    expect(renderTemplate(DEFAULT_TEMPLATE, { ...song, artist: undefined }, "linux")).toBe("NA - Never Gonna Give You Up.mp3");
  });

  test("folders from the template, never from a field's value", () => {
    const fields = { ...song, title: "AC/DC: Back?", album: "Live" };
    expect(renderTemplate("%(album)s/%(title)s.%(ext)s", fields, "linux")).toBe("Live/AC_DC_ Back_.mp3");
    expect(renderTemplate("/etc/%(title)s.%(ext)s", song, "linux")).toBe("etc/Never Gonna Give You Up.mp3");
  });

  test("defaults, number formats and padded playlist positions", () => {
    expect(renderTemplate("%(album|Singles)s/%(title)s.%(ext)s", song, "linux")).toBe("Singles/Never Gonna Give You Up.mp3");
    expect(renderTemplate("%(track_number)02d %(title)s.%(ext)s", { ...song, track_number: 3 }, "linux")).toBe("03 Never Gonna Give You Up.mp3");
    const inList = { ...song, playlist_index: 7, n_entries: 120 };
    expect(renderTemplate("%(playlist_index)s - %(title)s.%(ext)s", inList, "linux")).toBe("007 - Never Gonna Give You Up.mp3");
    expect(renderTemplate("100%% %(id)s.%(ext)s", song, "linux")).toBe("100% abcdefghijk.mp3");
  });

  test("names every file system takes", () => {
    expect(cleanSegment("CON.mp3", "win32")).toBe("CON.mp3!");
    expect(cleanSegment("trailing dots...", "linux")).toBe("trailing dots");
    expect(cleanSegment("a".repeat(300) + ".mp3", "linux")).toHaveLength(255);
    expect(cleanSegment("a".repeat(300) + ".mp3", "linux").endsWith(".mp3")).toBe(true);
    // One spelling of accents, so "skip existing" finds files again.
    expect(cleanSegment(`Beyonce${String.fromCharCode(0x301)}`, "linux")).toBe(`Beyonc${String.fromCharCode(0xe9)}`);
    expect(playlistFolder({ playlist_title: "My: List", playlist_id: "PL1" }, "linux")).toBe("My_ List");
    expect(playlistFolder({ playlist_id: "PL1" }, "linux")).toBe("PL1");
  });
});
