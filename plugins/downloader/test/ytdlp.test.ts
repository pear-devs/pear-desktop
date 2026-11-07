import { describe, expect, test } from "vitest";
import { isSiteCookie, toNetscape } from "../cookies.ts";
import {
  type ArgsOptions,
  buildArgs,
  canEmbedCover,
  type Capabilities,
  isDownloadablePlaylist,
  menuTarget,
  normalizePlaylistId,
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

  test("keeps the downloaded file as it is for the source format (.webm, .m4a), as pear-desktop did", () => {
    const args = buildArgs(options({ format: "source", capabilities: { ...caps, mutagen: true } }));
    expect(args).not.toContain("--extract-audio");
    expect(args).not.toContain("--audio-format");
    expect(args).toContain("--embed-metadata");
    // yt-dlp can't put a cover into WebM.
    expect(args).not.toContain("--embed-thumbnail");
  });

  test("MP3 at a constant 256 kbps, as pear-desktop's preset", () => {
    expect(valueOf(buildArgs(options()), "--audio-quality")).toBe("256K");
    expect(valueOf(buildArgs(options({ format: "opus" })), "--audio-quality")).toBe("0");
  });

  test("titles and artists without the video's dressing, as pear-desktop's cleanupName", () => {
    const args = buildArgs(options());
    const replacements = args.flatMap((arg, i) => (arg === "--replace-in-metadata" ? [args.slice(i + 1, i + 4)] : []));
    expect(replacements[0]).toEqual(["title,track,artist,creator,uploader,channel", String.raw`(?i)\s*(- topic)$`, ""]);
    expect(replacements.map(([, pattern]) => pattern)).toContain(String.raw`(?i)\s*[(|\[]official(.*?)[)|\]]`);
    expect(replacements.every(([fields]) => fields !== "playlist_title")).toBe(true);
  });

  test("playlist folders as pear-desktop named them, and the list's title for the label", () => {
    const args = buildArgs(options({ target: { videoId: "", playlistId: "PL1" } }));
    const folder = args.flatMap((arg, i) => (arg === "--replace-in-metadata" && args[i + 1] === "playlist_title" ? [args.slice(i + 2, i + 4)] : []));
    expect(folder[0]).toEqual([String.raw`[<>:"/\\|?*\x00-\x1f]+`, " "]);
    expect(folder).toContainEqual([" {2,}", " "]);
    expect(args).toContain("before_dl:pear-list %(playlist_title|)s");
    // Not for songs, nor without playlist folders.
    expect(buildArgs(options())).not.toContain("playlist_title");
    expect(buildArgs(options({ target: { videoId: "", playlistId: "PL1" }, playlistFolders: false }))).not.toContain("playlist_title");
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
  // Lines yt-dlp printed with buildArgs' templates, downloading an album's first two songs.
  test("parses progress in bytes, preferring the exact size over the estimate", () => {
    expect(parseLine("pear-progress 1024 3445462 NA")).toEqual({ type: "progress", bytes: 1024, total: 3445462 });
    expect(parseLine("pear-progress 3748382 3748382 NA")).toEqual({ type: "progress", bytes: 3748382, total: 3748382 });
    expect(parseLine("pear-progress 300 NA 1200.5")).toEqual({ type: "progress", bytes: 300, total: 1200.5 });
    expect(parseLine("pear-progress 300 NA NA")).toEqual({ type: "progress", bytes: 300, total: undefined });
    expect(parseLine("pear-progress NA NA NA")).toBeUndefined();
  });
  test("parses items, stages, results and diagnostics", () => {
    expect(parseLine("pear-item 1 2 lYBUbBu4W08 Never Gonna Give You Up")).toEqual({
      type: "item",
      index: 1,
      count: 2,
      videoId: "lYBUbBu4W08",
      title: "Never Gonna Give You Up",
    });
    expect(parseLine("pear-item NA NA dQw4w9WgXcQ Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)")).toEqual({
      type: "item",
      index: 1,
      count: 1,
      videoId: "dQw4w9WgXcQ",
      title: "Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)",
    });
    expect(parseLine("pear-file /music/Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster).webm")).toEqual({
      type: "file",
      file: "/music/Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster).webm",
    });
    expect(parseLine("pear-convert")).toEqual({ type: "convert" });
    expect(parseLine("pear-list My Playlist")).toEqual({ type: "list", title: "My Playlist" });
    expect(parseLine("pear-list ")).toBeUndefined();
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
  test("a playlist's radio stands for the playlist, as in pear-desktop", () => {
    expect(normalizePlaylistId("RDAMPLPLabc")).toBe("PLabc");
    expect(normalizePlaylistId("PLabc")).toBe("PLabc");
    expect(normalizePlaylistId("RDAMVMabc")).toBe("RDAMVMabc");
    expect(normalizePlaylistId("RDAMPL")).toBeUndefined();
    expect(normalizePlaylistId(null)).toBeUndefined();
  });
  test("overall progress spans playlist items", () => {
    expect(overallProgress(1, 1, 0.5)).toBe(0.5);
    expect(overallProgress(3, 4, 0.5)).toBe(0.625);
    expect(overallProgress(5, 4, 1)).toBe(1);
  });
});

describe("pear-desktop's Custom preset, session and menus", () => {
  test("custom ffmpeg arguments and extension", () => {
    const args = buildArgs(options({ format: "custom", customArgs: "-b:a 320k", customExtension: "flac" }));
    expect(valueOf(args, "--audio-format")).toBe("flac");
    expect(args).toContain("ExtractAudio+ffmpeg_o:-b:a 320k");
    // An extension yt-dlp can't convert to keeps the streamed format.
    expect(valueOf(buildArgs(options({ format: "custom", customExtension: "xyz" })), "--audio-format")).toBe("best");
  });

  test("the session's cookies go to yt-dlp as a Netscape file", () => {
    expect(valueOf(buildArgs(options({ cookiesFile: "/tmp/c.txt" })), "--cookies")).toBe("/tmp/c.txt");
    expect(buildArgs(options())).not.toContain("--cookies");
    const file = toNetscape([
      { domain: ".\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com", path: "/", secure: true, expirationDate: 1900000000.5, name: "SID", value: "x" },
      { domain: "music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com", hostOnly: true, name: "PREF", value: "y" },
    ]);
    expect(file.split("\n")).toEqual([
      "# Netscape HTTP Cookie File",
      "",
      ".\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com\tTRUE\t/\tTRUE\t1900000000\tSID\tx",
      "music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com\tFALSE\t/\tFALSE\t0\tPREF\ty",
      "",
    ]);
    expect(isSiteCookie({ domain: ".\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com", name: "a", value: "b" })).toBe(true);
    expect(isSiteCookie({ domain: ".google.com", name: "a", value: "b" })).toBe(false);
    expect(isSiteCookie({ domain: "evil\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com", name: "a", value: "b" })).toBe(false);
  });

  test("a menu's links say what it is for", () => {
    expect(menuTarget(["watch?v=abcdefghijk&list=RDAMVMabcdefghijk", "browse/MPREb_x"])).toEqual({ videoId: "abcdefghijk" });
    expect(menuTarget(["watch?playlist=OLAK5uy_album"])).toEqual({ videoId: "", playlistId: "OLAK5uy_album" });
    expect(menuTarget(["playlist?list=PLxyz"])).toEqual({ videoId: "", playlistId: "PLxyz" });
    expect(menuTarget(["browse/UCartist"])).toBeUndefined();
    // A playlist's radio is the playlist.
    expect(menuTarget(["watch?playlist=RDAMPLPLxyz"])).toEqual({ videoId: "", playlistId: "PLxyz" });
  });

  test("an episode's menu is for the episode, not its podcast", () => {
    // The episode's menu: "Go to podcast" (a playlist) and items without links.
    const menu = ["#", "playlist?list=PLpodcast"];
    expect(menuTarget(menu, ["watch?v=episode0001&list=PLpodcast", "browse/MPSPxyz"])).toEqual({ videoId: "episode0001" });
    expect(menuTarget(menu, ["podcast/episode0002"])).toEqual({ videoId: "episode0002" });
    expect(menuTarget(["#"], ["podcast/episode0002"])).toEqual({ videoId: "episode0002" });
    // A podcast's or a playlist's own card is the whole list.
    expect(menuTarget(menu, ["browse/MPSPxyz"])).toEqual({ videoId: "", playlistId: "PLpodcast" });
    expect(menuTarget(menu, ["playlist?list=PLpodcast", "watch?v=episode0001"])).toEqual({ videoId: "", playlistId: "PLpodcast" });
    // An album's "Shuffle play" stays the album, whatever the row.
    expect(menuTarget(["watch?playlist=OLAK5uy_album"], ["watch?v=abcdefghijk"])).toEqual({ videoId: "", playlistId: "OLAK5uy_album" });
  });
});
