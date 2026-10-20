import { describe, expect, test } from "vitest";
import {
  type ArgsOptions,
  buildArgs,
  canEmbedCover,
  type Capabilities,
  isDownloadablePlaylist,
  overallProgress,
  parseLine,
  parseProbe,
} from "../ytdlp.ts";

const caps: Capabilities = { version: "2026.08.19", ffmpeg: true, mutagen: false, atomicParsley: false };
const options = (patch: Partial<ArgsOptions> = {}): ArgsOptions => ({
  target: { videoId: "abc123" },
  folder: "/music/Pear Desktop",
  format: "mp3",
  template: "",
  playlistFolders: true,
  playlistLimit: 0,
  skipExisting: true,
  squareCover: true,
  ffmpegPath: "",
  capabilities: caps,
  ...patch,
});
const valueOf = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

describe("buildArgs", () => {
  test("downloads a single track as audio with metadata and a square cover", () => {
    const args = buildArgs(options());
    expect(args.slice(-2)).toEqual(["--", "https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/watch?v=abc123"]);
    expect(args).toContain("--no-playlist");
    expect(args).toContain("--extract-audio");
    expect(valueOf(args, "--audio-format")).toBe("mp3");
    expect(args).toContain("--embed-metadata");
    expect(args).toContain("--embed-thumbnail");
    expect(valueOf(args, "--postprocessor-args")).toContain("crop=");
    expect(valueOf(args, "--paths")).toBe("/music/Pear Desktop");
    expect(valueOf(args, "--output")).toBe("%(artist,creator,uploader)s - %(title)s.%(ext)s");
    expect(args).toContain("--no-overwrites");
  });

  test("downloads albums into their own folder with track numbers", () => {
    const args = buildArgs(options({ target: { videoId: "abc123", playlistId: "OLAK5uy_xyz" }, template: "%(title)s.%(ext)s" }));
    expect(args.at(-1)).toBe("https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/playlist?list=OLAK5uy_xyz");
    expect(args).toContain("--yes-playlist");
    expect(valueOf(args, "--output")).toBe("%(playlist_title,playlist_id)s/%(title)s.%(ext)s");
    expect(valueOf(args, "--parse-metadata")).toBe("%(playlist_index)s:%(track_number)s");
    expect(args).not.toContain("--playlist-end");
  });

  test("honours playlist options, overwrite mode and the ffmpeg location", () => {
    const args = buildArgs(
      options({
        target: { videoId: "a", playlistId: "PL123" },
        playlistFolders: false,
        playlistLimit: 25,
        skipExisting: false,
        ffmpegPath: "/opt/ffmpeg/bin",
        squareCover: false,
      }),
    );
    expect(valueOf(args, "--output")).toBe("%(artist,creator,uploader)s - %(title)s.%(ext)s");
    expect(valueOf(args, "--playlist-end")).toBe("25");
    expect(args).toContain("--force-overwrites");
    expect(valueOf(args, "--ffmpeg-location")).toBe("/opt/ffmpeg/bin");
    expect(args).not.toContain("--parse-metadata");
    expect(args).not.toContain("--postprocessor-args");
  });

  test("skips cover embedding the installed tools can't do", () => {
    expect(buildArgs(options({ format: "opus" }))).not.toContain("--embed-thumbnail");
    expect(buildArgs(options({ format: "opus", capabilities: { ...caps, mutagen: true } }))).toContain("--embed-thumbnail");
    expect(valueOf(buildArgs(options({ format: "m4a" })), "--format")).toBe("bestaudio[ext=m4a]/bestaudio/best");
  });

  test("keeps the streamed audio as it is for the source format", () => {
    const args = buildArgs(options({ format: "source", capabilities: { ...caps, mutagen: true } }));
    expect(valueOf(args, "--audio-format")).toBe("best");
    expect(args).toContain("--embed-thumbnail");
    expect(buildArgs(options({ format: "source" }))).not.toContain("--embed-thumbnail");
  });

  test("keeps templates inside the download folder", () => {
    expect(valueOf(buildArgs(options({ template: "/etc/%(title)s.%(ext)s" })), "--output")).toBe("etc/%(title)s.%(ext)s");
  });
});

describe("canEmbedCover", () => {
  test("mp3 needs ffmpeg; m4a mutagen or AtomicParsley; opus mutagen", () => {
    expect(canEmbedCover("mp3", caps)).toBe(true);
    expect(canEmbedCover("m4a", caps)).toBe(false);
    expect(canEmbedCover("m4a", { ...caps, atomicParsley: true })).toBe(true);
    expect(canEmbedCover("opus", caps)).toBe(false);
  });
});

describe("parseLine", () => {
  test("parses progress, preferring the exact size over the estimate", () => {
    expect(parseLine("pear-progress 512 1024 NA")).toEqual({ type: "progress", fraction: 0.5 });
    expect(parseLine("pear-progress 300 NA 1200.5")).toEqual({ type: "progress", fraction: 300 / 1200.5 });
    expect(parseLine("pear-progress 300 NA NA")).toBeUndefined();
  });
  test("parses items, stages, results and diagnostics", () => {
    expect(parseLine("pear-item 3 12 Song  with spaces")).toEqual({ type: "item", index: 3, count: 12, title: "Song  with spaces" });
    expect(parseLine("pear-item NA NA Single")).toEqual({ type: "item", index: 1, count: 1, title: "Single" });
    expect(parseLine("pear-convert")).toEqual({ type: "convert" });
    expect(parseLine("pear-done /music/Pear Desktop/A - B.mp3\n")).toEqual({ type: "done", file: "/music/Pear Desktop/A - B.mp3" });
    expect(parseLine("ERROR: [\u0079\u006f\u0075\u0074\u0075\u0062\u0065] abc: Video unavailable")).toEqual({ type: "error", message: "[\u0079\u006f\u0075\u0074\u0075\u0062\u0065] abc: Video unavailable" });
    expect(parseLine("WARNING: something")).toEqual({ type: "warning", message: "something" });
    expect(parseLine("[download] Destination: x.webm")).toBeUndefined();
  });
});

describe("parseProbe", () => {
  test("reads the version, ffmpeg and optional libraries", () => {
    const output = [
      "[debug] yt-dlp version stable@2026.08.19 from yt-dlp/yt-dlp [594bd50c2]",
      "[debug] exe versions: ffmpeg 9.0.2 (setts), ffprobe 9.0.2, rtmpdump 2.6",
      "[debug] Optional libraries: certifi-2026.07.22, mutagen-1.47.0, requests-2.34.2",
    ].join("\n");
    expect(parseProbe(output)).toEqual({ version: "2026.08.19", ffmpeg: true, mutagen: true, atomicParsley: false });
  });
  test("notices missing ffmpeg", () => {
    expect(parseProbe("[debug] exe versions: none\n[debug] Optional libraries: certifi")).toMatchObject({
      ffmpeg: false,
      mutagen: false,
    });
  });
});

describe("helpers", () => {
  test("only finite playlists are downloadable", () => {
    expect(isDownloadablePlaylist("OLAK5uy_abc")).toBe(true);
    expect(isDownloadablePlaylist("PLabc")).toBe(true);
    expect(isDownloadablePlaylist("RDCLAK5uy_abc")).toBe(true);
    expect(isDownloadablePlaylist("RDAMVMabc")).toBe(false);
    expect(isDownloadablePlaylist(undefined)).toBe(false);
  });
  test("overall progress spans playlist items", () => {
    expect(overallProgress(1, 1, 0.5)).toBe(0.5);
    expect(overallProgress(3, 4, 0.5)).toBe(0.625);
    expect(overallProgress(5, 4, 1)).toBe(1);
  });
});
