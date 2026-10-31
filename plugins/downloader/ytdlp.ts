// yt-dlp as a sidecar: argument building, output parsing and capability probing.
// Pure functions (no Electron, no processes) so they are unit-testable.

import { YTM_ORIGIN, ytmUrl } from "@pear/sdk/util";

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
  // Opus or M4A, whichever was streamed: mutagen writes both.
  if (format === "source") return capabilities.mutagen;
  if (format === "m4a") return capabilities.mutagen || capabilities.atomicParsley;
  return capabilities.mutagen;
}

export function buildArgs(options: ArgsOptions): string[] {
  const playlist = options.target.playlistId !== undefined;
  const url = playlist ? ytmUrl(`/playlist?list=${options.target.playlistId}`) : ytmUrl(`/watch?v=${options.target.videoId}`);
  const template = (options.template.trim() || DEFAULT_TEMPLATE).replace(/^[/\\]+/, "");
  const output = playlist && options.playlistFolders ? `%(playlist_title,playlist_id)s/${template}` : template;

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
    "--extract-audio",
    "--audio-format",
    audioFormatArg(options),
    "--audio-quality",
    "0",
    "--embed-metadata",
    "--paths",
    options.folder,
    "--output",
    output,
    playlist ? "--yes-playlist" : "--no-playlist",
    options.skipExisting ? "--no-overwrites" : "--force-overwrites",
  ];
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

/** yt-dlp's --audio-format; "best" keeps the streamed codec and only remuxes it. */
function audioFormatArg(options: ArgsOptions) {
  if (options.format === "source") return "best";
  if (options.format === "custom") return customAudioFormat(options.customExtension ?? "");
  return options.format;
}

export type OutputEvent =
  | { type: "item"; index: number; count: number; videoId: string; title: string }
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

/** What a YTM menu's links point at, as pear-desktop read them: a playlist or album, else a track. */
export function menuTarget(hrefs: readonly string[]): DownloadTarget | undefined {
  let videoId: string | undefined;
  for (const href of hrefs) {
    const url = new URL(href, YTM_ORIGIN);
    const playlist = url.searchParams.get("playlist") ?? (url.pathname === "/playlist" ? url.searchParams.get("list") : null);
    if (playlist && isDownloadablePlaylist(playlist)) return { videoId: "", playlistId: playlist };
    videoId ??= url.searchParams.get("v") ?? undefined;
  }
  return videoId ? { videoId } : undefined;
}
