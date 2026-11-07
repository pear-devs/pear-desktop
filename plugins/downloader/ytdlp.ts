// yt-dlp as a sidecar: argument building, output parsing and capability probing.
// Pure functions (no Electron, no processes) so they are unit-testable.

import { YTM_ORIGIN, ytmUrl } from "@pear/sdk/util";
import { cleanupArgs } from "./names.ts";

/**
 * "source": the audio as streamed (usually Opus), without re-encoding.
 * "custom": pear-desktop's Custom preset, with its own ffmpeg arguments and extension.
 */
export type AudioFormat = "opus" | "m4a" | "mp3" | "source" | "custom";

/** The extensions yt-dlp can convert audio to (--audio-format). */
export const YTDLP_AUDIO_FORMATS = ["aac", "alac", "flac", "m4a", "mp3", "opus", "vorbis", "wav"] as const;

/** The extension a custom preset converts to, or "best" (keep the streamed codec). */
export const customAudioFormat = (extension: string) => {
  const ext = extension.trim().replace(/^\./, "").toLowerCase();
  return (YTDLP_AUDIO_FORMATS as readonly string[]).includes(ext) ? ext : "best";
};

export interface DownloadTarget {
  videoId: string;
  /** Download this playlist or album instead of the single track. */
  playlistId?: string;
  /** Only these positions of the playlist (1-based), e.g. the ones another engine couldn't do. */
  items?: number[];
}

export interface Capabilities {
  version: string;
  ffmpeg: boolean;
  mutagen: boolean;
  atomicParsley: boolean;
}

export interface ArgsOptions {
  target: DownloadTarget;
  folder: string;
  format: AudioFormat;
  template: string;
  playlistFolders: boolean;
  /** 0 = whole playlist. */
  playlistLimit: number;
  skipExisting: boolean;
  squareCover: boolean;
  ffmpegPath: string;
  capabilities: Capabilities;
  /** The custom preset's ffmpeg arguments and extension (format "custom"). */
  customArgs?: string;
  customExtension?: string;
  /** A Netscape cookies file with the signed-in session, for private playlists and age-restricted tracks. */
  cookiesFile?: string;
  /** The folder's list of downloaded ids (--download-archive), when skipping by id. */
  archiveFile?: string;
}

export const DEFAULT_TEMPLATE = "%(artist,creator,uploader)s - %(title)s.%(ext)s";

// Prefer a source stream that needs no re-encoding.
const FORMAT_SELECTORS: Record<AudioFormat, string> = {
  opus: "bestaudio[acodec=opus]/bestaudio/best",
  m4a: "bestaudio[ext=m4a]/bestaudio/best",
  mp3: "bestaudio/best",
  source: "bestaudio/best",
  custom: "bestaudio/best",
};

/** A playlist's radio ("RDAMPL<id>") stands for the playlist itself, as pear-desktop downloaded it. */
const PLAYLIST_RADIO = "RDAMPL";

/** The playlist an id is about: a playlist's radio is that playlist. */
export function normalizePlaylistId(playlistId: string | null | undefined): string | undefined {
  if (!playlistId) return undefined;
  return playlistId.startsWith(PLAYLIST_RADIO) ? playlistId.slice(PLAYLIST_RADIO.length) || undefined : playlistId;
}

/** Radios and mixes ("RD…") are endless, except YTM's curated "RDCLAK…" playlists. */
export const isDownloadablePlaylist = (playlistId: string | undefined): playlistId is string =>
  !!playlistId && (!playlistId.startsWith("RD") || playlistId.startsWith("RDCLAK"));

export const isAlbum = (playlistId: string | undefined) => !!playlistId?.startsWith("OLAK5uy_");

/** yt-dlp writes cover art into opus/ogg (and reliably into m4a) only through mutagen or AtomicParsley. */
export function canEmbedCover(format: AudioFormat, capabilities: Capabilities, customExtension = "") {
  if (format === "custom") {
    const ext = customAudioFormat(customExtension);
    return ext === "mp3" || ext === "flac" ? capabilities.ffmpeg : capabilities.mutagen;
  }
  if (format === "mp3") return capabilities.ffmpeg;
  // The stream as it came (WebM, usually), which yt-dlp can't put a cover in; pear-desktop didn't either.
  if (format === "source") return false;
  if (format === "m4a") return capabilities.mutagen || capabilities.atomicParsley;
  return capabilities.mutagen;
}

export function buildArgs(options: ArgsOptions): string[] {
  const playlist = options.target.playlistId !== undefined;
  const url = playlist ? ytmUrl(`/playlist?list=${options.target.playlistId}`) : ytmUrl(`/watch?v=${options.target.videoId}`);
  const template = (options.template.trim() || DEFAULT_TEMPLATE).replace(/^[/\\]+/, "");
  const folders = playlist && options.playlistFolders;
  const output = folders ? `%(playlist_title,playlist_id)s/${template}` : template;
  // "Source" keeps the downloaded file as it is, named by its container (.webm, .m4a), as pear-desktop did.
  const extract = options.format !== "source";

  const args = [
    "--newline",
    "--no-colors",
    "--no-simulate",
    "--progress",
    "--progress-template",
    "download:pear-progress %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s",
    "--print",
    "before_dl:pear-item %(playlist_index)s %(n_entries)s %(id)s %(title)s",
    // --print keeps yt-dlp quiet, "[download] Destination: …" included; the file it starts.
    "--print",
    "before_dl:pear-file %(filename)s",
    "--print",
    "post_process:pear-convert",
    "--print",
    "after_move:pear-done %(filepath)s",
    "--format",
    FORMAT_SELECTORS[options.format],
    ...(extract ? ["--extract-audio", "--audio-format", audioFormatArg(options), "--audio-quality", audioQuality(options.format)] : []),
    "--embed-metadata",
    // Titles and artists without "(Official Video)", "VEVO", " - Topic"…, as pear-desktop named and tagged them.
    ...cleanupArgs(),
    "--paths",
    options.folder,
    "--output",
    output,
    playlist ? "--yes-playlist" : "--no-playlist",
    options.skipExisting ? "--no-overwrites" : "--force-overwrites",
  ];
  // The list's title, for the download's label.
  if (playlist) args.push("--print", "before_dl:pear-list %(playlist_title|)s");
  // The list's folder as pear-desktop named it: reserved characters become spaces.
  if (folders) args.push(...PLAYLIST_FOLDER_ARGS);
  // pear-desktop's Custom preset: its ffmpeg arguments for the conversion.
  if (options.format === "custom" && options.customArgs?.trim()) args.push("--postprocessor-args", `ExtractAudio+ffmpeg_o:${options.customArgs.trim()}`);
  if (options.cookiesFile) args.push("--cookies", options.cookiesFile);
  if (options.archiveFile) args.push("--download-archive", options.archiveFile);
  if (canEmbedCover(options.format, options.capabilities, options.customExtension)) {
    args.push("--embed-thumbnail", "--convert-thumbnails", "jpg");
    // YTM artwork comes as 16:9 with the square cover in the middle.
    if (options.squareCover) args.push("--postprocessor-args", `ThumbnailsConvertor+ffmpeg_o:-vf "crop='min(iw,ih)':'min(iw,ih)'"`);
  }
  // Album positions become track numbers.
  if (isAlbum(options.target.playlistId)) args.push("--parse-metadata", "%(playlist_index)s:%(track_number)s");
  const items = options.target.items;
  if (playlist && items?.length) args.push("--playlist-items", items.join(","));
  else if (playlist && options.playlistLimit > 0) args.push("--playlist-end", String(options.playlistLimit));
  if (options.ffmpegPath) args.push("--ffmpeg-location", options.ffmpegPath);
  args.push("--", url);
  return args;
}

/** pear-desktop's "mp3 (256kbps)": constant 256 kbps; the best quality otherwise. */
const audioQuality = (format: AudioFormat) => (format === "mp3" ? "256K" : "0");

/** filenamify(title, { replacement: " " }): reserved characters as one space, no runs of spaces, nothing around. */
const PLAYLIST_FOLDER_ARGS = [
  [String.raw`[<>:"/\\|?*\x00-\x1f]+`, " "],
  [String.raw`\.+$`, ""],
  [" {2,}", " "],
  ["^ +| +$", ""],
].flatMap(([pattern, replacement]) => ["--replace-in-metadata", "playlist_title", pattern!, replacement!]);

/** yt-dlp's --audio-format; "best" keeps the streamed codec and only remuxes it. */
function audioFormatArg(options: ArgsOptions) {
  if (options.format === "source") return "best";
  if (options.format === "custom") return customAudioFormat(options.customExtension ?? "");
  return options.format;
}

export type OutputEvent =
  | { type: "item"; index: number; count: number; videoId: string; title: string }
  /** The playlist's title. */
  | { type: "list"; title: string }
  /** Bytes of the current song received, and in all when yt-dlp knows or estimates it. */
  | { type: "progress"; bytes: number; total: number | undefined }
  /** The file the song is downloaded to (its partial download is `<file>.part`). */
  | { type: "file"; file: string }
  | { type: "convert" }
  | { type: "done"; file: string }
  | { type: "error"; message: string }
  | { type: "warning"; message: string };

const number = (text: string | undefined) => {
  const value = Number(text);
  return text && text !== "NA" && Number.isFinite(value) ? value : undefined;
};

/** One line of yt-dlp's stdout or stderr. */
export function parseLine(line: string): OutputEvent | undefined {
  const text = line.trim();
  if (text.startsWith("pear-progress ")) {
    const [, downloaded, total, estimate] = text.split(" ");
    const bytes = number(downloaded);
    if (bytes === undefined) return undefined;
    return { type: "progress", bytes, total: number(total) ?? number(estimate) };
  }
  if (text.startsWith("pear-item ")) {
    const [, index, count, videoId, ...title] = text.split(" ");
    return { type: "item", index: number(index) ?? 1, count: number(count) ?? 1, videoId: videoId ?? "", title: title.join(" ") };
  }
  if (text.startsWith("pear-list ")) {
    const title = text.slice("pear-list ".length).trim();
    return title && title !== "NA" ? { type: "list", title } : undefined;
  }
  if (text.startsWith("pear-file ")) return { type: "file", file: text.slice("pear-file ".length) };
  if (text === "pear-convert") return { type: "convert" };
  if (text.startsWith("pear-done ")) return { type: "done", file: text.slice("pear-done ".length) };
  if (text.startsWith("ERROR: ")) return { type: "error", message: text.slice("ERROR: ".length) };
  if (text.startsWith("WARNING: ")) return { type: "warning", message: text.slice("WARNING: ".length) };
  return undefined;
}

/** A file yt-dlp starts writing ("[download] Destination: …", also its post-processors'), to remove if cancelled. */
export function parseDestination(line: string): string | undefined {
  return /^\[\w+\] Destination: (.+)$/.exec(line.trim())?.[1];
}

/** Parses `yt-dlp -v`'s debug header. */
export function parseProbe(output: string): Capabilities {
  const field = (name: string) => new RegExp(`\\[debug\\] ${name}: (.*)`).exec(output)?.[1] ?? "";
  const exes = field("exe versions").toLowerCase();
  const libraries = field("Optional libraries").toLowerCase();
  return {
    version: /yt-dlp version (?:\S+@)?(\S+)/.exec(output)?.[1] ?? "unknown",
    ffmpeg: /\bffmpeg\b/.test(exes) && /\bffprobe\b/.test(exes),
    mutagen: /\bmutagen\b/.test(libraries),
    atomicParsley: /\batomicparsley\b/.test(exes),
  };
}

/** Overall progress of a job in [0, 1]. */
export function overallProgress(index: number, count: number, fraction: number) {
  const total = Math.max(1, count);
  return Math.min(1, (Math.max(1, index) - 1 + fraction) / total);
}

/**
 * What a YTM menu is for, from its links and those of the row it was opened
 * from: a playlist or album, else a track. An episode's menu links to its
 * podcast ("Go to podcast"), which is a playlist: the episode is what it's for.
 */
export function menuTarget(hrefs: readonly string[], row: readonly string[] = []): DownloadTarget | undefined {
  const rowVideo = rowVideoId(row);
  let videoId: string | undefined;
  for (const href of hrefs) {
    const url = parseHref(href);
    if (!url) continue;
    // "Shuffle play" or "Start radio" of a list, or "Go to playlist" / "Go to podcast".
    const played = url.searchParams.get("playlist");
    const linked = url.pathname === "/playlist" ? url.searchParams.get("list") : null;
    const playlist = normalizePlaylistId(played ?? linked);
    if (isDownloadablePlaylist(playlist)) {
      if (!played && rowVideo) return { videoId: rowVideo };
      return { videoId: "", playlistId: playlist };
    }
    videoId ??= videoIdOf(url);
  }
  videoId ??= rowVideo;
  return videoId ? { videoId } : undefined;
}

/** The track a row shows (a song or an episode); none for a row of a playlist. */
function rowVideoId(hrefs: readonly string[]) {
  let videoId: string | undefined;
  for (const href of hrefs) {
    const url = parseHref(href);
    if (!url) continue;
    if (url.pathname === "/playlist" || url.pathname.startsWith("/browse/VL")) return undefined;
    videoId ??= videoIdOf(url);
  }
  return videoId;
}

/** A track's id from its link: `watch?v=<id>`, or an episode's `podcast/<id>`. */
function videoIdOf(url: URL) {
  return url.searchParams.get("v") ?? /^\/podcast\/([\w-]{11})$/.exec(url.pathname)?.[1] ?? undefined;
}

function parseHref(href: string) {
  try {
    return new URL(href, YTM_ORIGIN);
  } catch {
    return undefined;
  }
}
