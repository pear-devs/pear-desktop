// yt-dlp as a sidecar: argument building, output parsing and capability probing.
// Pure functions (no Electron, no processes) so they are unit-testable.

/** "source": the audio as streamed (usually Opus), without re-encoding. */
export type AudioFormat = "opus" | "m4a" | "mp3" | "source";

export interface DownloadTarget {
  videoId: string;
  /** Download this playlist or album instead of the single track. */
  playlistId?: string;
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
}

export const DEFAULT_TEMPLATE = "%(artist,creator,uploader)s - %(title)s.%(ext)s";
const YTM = "https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com";

// Prefer a source stream that needs no re-encoding.
const FORMAT_SELECTORS: Record<AudioFormat, string> = {
  opus: "bestaudio[acodec=opus]/bestaudio/best",
  m4a: "bestaudio[ext=m4a]/bestaudio/best",
  mp3: "bestaudio/best",
  source: "bestaudio/best",
};

/** Radios and mixes ("RD…") are endless, except YTM's curated "RDCLAK…" playlists. */
export const isDownloadablePlaylist = (playlistId: string | undefined): playlistId is string =>
  !!playlistId && (!playlistId.startsWith("RD") || playlistId.startsWith("RDCLAK"));

export const isAlbum = (playlistId: string | undefined) => !!playlistId?.startsWith("OLAK5uy_");

/** yt-dlp writes cover art into opus/ogg (and reliably into m4a) only through mutagen or AtomicParsley. */
export function canEmbedCover(format: AudioFormat, capabilities: Capabilities) {
  if (format === "mp3") return capabilities.ffmpeg;
  // Opus or M4A, whichever was streamed: mutagen writes both.
  if (format === "source") return capabilities.mutagen;
  if (format === "m4a") return capabilities.mutagen || capabilities.atomicParsley;
  return capabilities.mutagen;
}

export function buildArgs(o: ArgsOptions): string[] {
  const playlist = o.target.playlistId !== undefined;
  const url = playlist ? `${YTM}/playlist?list=${o.target.playlistId}` : `${YTM}/watch?v=${o.target.videoId}`;
  const template = (o.template.trim() || DEFAULT_TEMPLATE).replace(/^[/\\]+/, "");
  const output = playlist && o.playlistFolders ? `%(playlist_title,playlist_id)s/${template}` : template;

  const args = [
    "--newline",
    "--no-colors",
    "--no-simulate",
    "--progress",
    "--progress-template",
    "download:pear-progress %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s",
    "--print",
    "before_dl:pear-item %(playlist_index)s %(n_entries)s %(title)s",
    "--print",
    "post_process:pear-convert",
    "--print",
    "after_move:pear-done %(filepath)s",
    "--format",
    FORMAT_SELECTORS[o.format],
    "--extract-audio",
    "--audio-format",
    // "best" keeps the streamed codec and only remuxes it.
    o.format === "source" ? "best" : o.format,
    "--audio-quality",
    "0",
    "--embed-metadata",
    "--paths",
    o.folder,
    "--output",
    output,
    playlist ? "--yes-playlist" : "--no-playlist",
    o.skipExisting ? "--no-overwrites" : "--force-overwrites",
  ];
  if (canEmbedCover(o.format, o.capabilities)) {
    args.push("--embed-thumbnail", "--convert-thumbnails", "jpg");
    // YTM artwork comes as 16:9 with the square cover in the middle.
    if (o.squareCover) args.push("--postprocessor-args", `ThumbnailsConvertor+ffmpeg_o:-vf "crop='min(iw,ih)':'min(iw,ih)'"`);
  }
  // Album positions become track numbers.
  if (isAlbum(o.target.playlistId)) args.push("--parse-metadata", "%(playlist_index)s:%(track_number)s");
  if (playlist && o.playlistLimit > 0) args.push("--playlist-end", String(o.playlistLimit));
  if (o.ffmpegPath) args.push("--ffmpeg-location", o.ffmpegPath);
  args.push("--", url);
  return args;
}

export type OutputEvent =
  | { type: "item"; index: number; count: number; title: string }
  | { type: "progress"; fraction: number }
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
    const done = number(downloaded);
    const size = number(total) ?? number(estimate);
    if (done === undefined || !size) return undefined;
    return { type: "progress", fraction: Math.min(1, done / size) };
  }
  if (text.startsWith("pear-item ")) {
    const [, index, count, ...title] = text.split(" ");
    return { type: "item", index: number(index) ?? 1, count: number(count) ?? 1, title: title.join(" ") };
  }
  if (text === "pear-convert") return { type: "convert" };
  if (text.startsWith("pear-done ")) return { type: "done", file: text.slice("pear-done ".length) };
  if (text.startsWith("ERROR: ")) return { type: "error", message: text.slice("ERROR: ".length) };
  if (text.startsWith("WARNING: ")) return { type: "warning", message: text.slice("WARNING: ".length) };
  return undefined;
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
