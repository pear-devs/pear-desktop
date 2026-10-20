import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { YTM_ORIGIN } from "@pear/sdk/util";
import { afterEach, describe, expect, test } from "vitest";
import { Archive, ARCHIVE_NAME, archiveLine, parseArchive } from "../archive.ts";
import { buildArgs } from "../ytdlp.ts";

// yt-dlp's name for the site, from YTM's origin.
const site = new URL(YTM_ORIGIN).hostname.split(".")[1]!;
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("download archive", () => {
  test("yt-dlp's format: one '<site> <id>' line per song", () => {
    expect(archiveLine("abcdefghijk")).toBe(`${site} abcdefghijk\n`);
    expect(parseArchive(`${site} a1\n\nsoundcloud 123\n${site} b2\r\n`)).toEqual(new Set(["a1", "b2"]));
  });

  test("remembers songs in the folder", async () => {
    const folder = mkdtempSync(join(tmpdir(), "pear-dl-archive-"));
    dirs.push(folder);
    const archive = new Archive(folder);
    expect(await archive.has("abcdefghijk")).toBe(false);
    await archive.add("abcdefghijk");
    expect(await new Archive(folder).has("abcdefghijk")).toBe(true);
    expect(readFileSync(join(folder, ARCHIVE_NAME), "utf8")).toBe(archiveLine("abcdefghijk"));
  });

  test("yt-dlp shares it", () => {
    const args = buildArgs({
      target: { videoId: "abc" },
      folder: "/music",
      format: "mp3",
      template: "",
      playlistFolders: true,
      playlistLimit: 0,
      skipExisting: true,
      squareCover: true,
      ffmpegPath: "",
      capabilities: { version: "1", ffmpeg: true, mutagen: true, atomicParsley: false },
      archiveFile: "/music/.pear-downloaded.txt",
    });
    expect(args[args.indexOf("--download-archive") + 1]).toBe("/music/.pear-downloaded.txt");
  });
});
