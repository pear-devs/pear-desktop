// Converting a downloaded stream into the file people keep, with its tags and
// cover (host only). Native ffmpeg when there is one (set in the settings,
// installed on the computer, or the copy this plugin downloads for yt-dlp);
// otherwise ffmpeg.wasm, loaded the first time it is needed, as pear-desktop
// converted. The argument building is pure and unit-tested.

import { spawn } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { Tags as Id3Tags } from "node-id3";
import type { AudioFormat } from "./ytdlp.ts";

/** The formats the built-in engine writes (the Custom preset stays with yt-dlp). */
export type BuiltInFormat = Exclude<AudioFormat, "custom">;
export type Extension = "mp3" | "m4a" | "opus";

/** What a stream holds, from its MIME type. */
export interface SourceStream {
  codec: "opus" | "aac" | "other";
}

export interface Tags {
  title: string;
  artist?: string | undefined;
  album?: string | undefined;
  albumArtist?: string | undefined;
  year?: number | undefined;
  track?: number | undefined;
  trackCount?: number | undefined;
  /** Unsynced lyrics. */
  lyrics?: string | undefined;
}

export interface Cover {
  /** A JPEG. */
  data: Buffer;
  width: number;
  height: number;
}

/** EBU R128 loudness of a song: integrated loudness (LUFS) and true peak (dBFS). */
export interface Loudness {
  integrated: number;
  peak: number;
}

export interface ConvertJob {
  input: string;
  output: string;
  ext: Extension;
  codecArgs: string[];
  tags: Tags;
  cover?: Cover | undefined;
  /** Also measure the loudness and write ReplayGain tags (the audio itself stays as it is). */
  replayGain?: boolean | undefined;
  /** The song's length, for progress. */
  duration: number;
  signal: AbortSignal;
  onProgress(fraction: number): void;
}

export interface Converter {
  readonly kind: "native" | "wasm";
  convert(job: ConvertJob): Promise<void>;
}

/** The file to write and how, for a format and what was streamed; copying when no re-encoding is needed. */
export function outputFor(format: BuiltInFormat, source: SourceStream): { ext: Extension; codecArgs: string[] } {
  const copy = ["-c:a", "copy"];
  switch (format) {
    case "mp3":
      // yt-dlp's --audio-quality 0: the best VBR.
      return { ext: "mp3", codecArgs: ["-c:a", "libmp3lame", "-q:a", "0"] };
    case "m4a":
      return { ext: "m4a", codecArgs: source.codec === "aac" ? copy : ["-c:a", "aac", "-b:a", "256k"] };
    case "opus":
      return { ext: "opus", codecArgs: source.codec === "opus" ? copy : ["-c:a", "libopus", "-b:a", "160k"] };
    case "source":
      return source.codec === "aac" ? { ext: "m4a", codecArgs: copy } : { ext: "opus", codecArgs: copy };
  }
}

/** The stream to ask for: one in the codec the format keeps as it is. */
export function preferredContainer(format: BuiltInFormat): "mp4" | "webm" | "any" {
  if (format === "m4a") return "mp4";
  if (format === "opus" || format === "source") return "webm";
  return "any";
}

export const codecOf = (mimeType: string): SourceStream["codec"] => {
  if (/opus/i.test(mimeType)) return "opus";
  if (/mp4a|aac/i.test(mimeType)) return "aac";
  return "other";
};

// ---------------------------------------------------------------- tags

/** `;FFMETADATA1` escaping: `=`, `;`, `#`, `\` and newlines get a backslash. */
const escapeMetadata = (value: string) => value.replace(/[=;#\\\n]/g, (char) => `\\${char}`);

/**
 * ReplayGain 2.0 (reference −18 LUFS) for MP3; Opus has its own R128 tag (−23 LUFS,
 * Q7.8). ffmpeg's MP4 muxer drops tags it doesn't know, so M4A gets none.
 */
export function loudnessTags(ext: Extension, loudness: Loudness): Record<string, string> {
  if (ext === "m4a") return {};
  if (ext === "opus") {
    const q78 = Math.round((-23 - loudness.integrated) * 256);
    return { R128_TRACK_GAIN: String(Math.max(-32768, Math.min(32767, q78))) };
  }
  const gain = -18 - loudness.integrated;
  return {
    REPLAYGAIN_TRACK_GAIN: `${gain >= 0 ? "+" : ""}${gain.toFixed(2)} dB`,
    REPLAYGAIN_TRACK_PEAK: (10 ** (loudness.peak / 20)).toFixed(6),
  };
}

/** ffmpeg's `ebur128=peak=true` summary. */
export function parseLoudness(output: string): Loudness | undefined {
  const summary = output.slice(output.lastIndexOf("Summary:"));
  const integrated = /I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1];
  const peak = /Peak:\s+(-?[\d.]+|-inf) dBFS/.exec(summary)?.[1];
  if (integrated === undefined || peak === undefined) return undefined;
  return { integrated: Number(integrated), peak: peak === "-inf" ? -Infinity : Number(peak) };
}

/** Measures loudness without writing anything. */
const LOUDNESS_ARGS = ["-af", "ebur128=peak=true", "-f", "null", "-"];

/**
 * The tags by ffmpeg's names, for a file of type `ext`. ffmpeg writes MP3 lyrics
 * as a TXXX frame players don't read, so those go in as USLT afterwards (node-id3).
 */
export function metadataOf(tags: Tags, ext: Extension, extra: Record<string, string> = {}): Record<string, string> {
  const entries: [string, string | number | undefined][] = [
    ["title", tags.title],
    ["artist", tags.artist],
    ["album", tags.album],
    ["album_artist", tags.albumArtist],
    ["date", tags.year],
    ["track", tags.track && (tags.trackCount ? `${tags.track}/${tags.trackCount}` : tags.track)],
    ["lyrics", ext === "mp3" ? undefined : tags.lyrics],
  ];
  const metadata: Record<string, string> = {};
  for (const [key, value] of entries) if (value !== undefined && value !== "") metadata[key] = String(value);
  return { ...metadata, ...extra };
}

/** An ffmetadata file: no length limit, unlike the command line (Windows: 32k), so Opus covers fit. */
export function ffmetadata(metadata: Record<string, string>) {
  const lines = Object.entries(metadata).map(([key, value]) => `${escapeMetadata(key)}=${escapeMetadata(value)}`);
  return `;FFMETADATA1\n${lines.join("\n")}\n`;
}

/** A FLAC picture block, base64: how Ogg files carry their cover (METADATA_BLOCK_PICTURE). */
export function pictureBlock(cover: Cover) {
  const mime = Buffer.from("image/jpeg");
  const description = Buffer.from("Cover");
  const u32 = (value: number) => {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32BE(value);
    return buffer;
  };
  const FRONT_COVER = 3;
  const COLOR_DEPTH = 24;
  return Buffer.concat([
    u32(FRONT_COVER),
    u32(mime.length),
    mime,
    u32(description.length),
    description,
    u32(cover.width),
    u32(cover.height),
    u32(COLOR_DEPTH),
    u32(0),
    u32(cover.data.length),
    cover.data,
  ]).toString("base64");
}

export interface ArgsInput {
  input: string;
  metadataFile: string;
  /** The cover as a separate input (MP3 and M4A); Opus carries it in the metadata. */
  coverFile?: string | undefined;
  output: string;
  ext: Extension;
  codecArgs: string[];
}

/** ffmpeg's arguments for a conversion with tags and, for MP3 and M4A, the cover as an attached picture. */
export function ffmpegArgs({ input, metadataFile, coverFile, output, ext, codecArgs }: ArgsInput): string[] {
  const args = ["-i", input, "-i", metadataFile];
  if (coverFile && ext !== "opus") args.push("-i", coverFile);
  // Only the audio and the tags given here (no video, no tags of the stream such as its encoder).
  args.push("-map", "0:a:0", "-map_metadata", "1", "-map_metadata:s:a", "-1", ...codecArgs);
  if (coverFile && ext !== "opus") {
    args.push("-map", "2:v", "-c:v", "copy", "-disposition:v", "attached_pic");
    if (ext === "mp3") args.push("-metadata:s:v", "title=Album cover", "-metadata:s:v", "comment=Cover (front)");
  }
  if (ext === "mp3") args.push("-id3v2_version", "3");
  args.push("-f", muxerOf(ext), output);
  return args;
}

/** The muxer, so temporary names don't decide it. */
const muxerOf = (ext: Extension) => (ext === "m4a" ? "ipod" : ext === "opus" ? "ogg" : "mp3");

/** The tags for the metadata file: Opus's cover goes in as a picture block. */
function metadataFor(job: Pick<ConvertJob, "ext" | "tags" | "cover">, loudness: Loudness | undefined) {
  const extra: Record<string, string> = loudness ? loudnessTags(job.ext, loudness) : {};
  if (job.ext === "opus" && job.cover) extra.METADATA_BLOCK_PICTURE = pictureBlock(job.cover);
  return metadataOf(job.tags, job.ext, extra);
}

/** `-progress` reports the position written so far. */
export function parseProgressLine(line: string): number | undefined {
  const match = /^out_time_(us|ms)=(\d+)$/.exec(line.trim());
  // Despite its name, out_time_ms is in microseconds too.
  return match ? Number(match[2]) / 1_000_000 : undefined;
}

// ---------------------------------------------------------------- native

/** Converts with an ffmpeg program. */
export class NativeConverter implements Converter {
  readonly kind = "native";
  readonly #ffmpeg: string;

  constructor(ffmpeg: string) {
    this.#ffmpeg = ffmpeg;
  }

  async convert(job: ConvertJob) {
    const loudness = job.replayGain ? await this.#loudness(job.input, job.signal) : undefined;
    const metadataFile = `${job.output}.meta.txt`;
    const coverFile = job.cover && job.ext !== "opus" ? `${job.output}.cover.jpg` : undefined;
    try {
      await writeFile(metadataFile, ffmetadata(metadataFor(job, loudness)));
      if (coverFile) await writeFile(coverFile, job.cover!.data);
      const args = ffmpegArgs({ ...job, metadataFile, coverFile });
      await this.#run(["-y", "-nostdin", "-hide_banner", "-loglevel", "error", "-progress", "pipe:1", "-nostats", ...args], job);
      if (job.ext === "mp3" && job.tags.lyrics) await writeFile(job.output, await addMp3Lyrics(await readFile(job.output), job.tags.lyrics));
    } finally {
      await Promise.all([metadataFile, coverFile].map((file) => file && rm(file, { force: true })));
    }
  }

  async #loudness(input: string, signal: AbortSignal) {
    const { stderr } = await this.#spawn(["-nostdin", "-hide_banner", "-nostats", "-i", input, ...LOUDNESS_ARGS], signal);
    return parseLoudness(stderr);
  }

  async #run(args: string[], job: ConvertJob) {
    const onLine = (line: string) => {
      const seconds = parseProgressLine(line);
      if (seconds !== undefined && job.duration > 0) job.onProgress(Math.min(1, seconds / job.duration));
    };
    await this.#spawn(args, job.signal, onLine);
  }

  #spawn(args: string[], signal: AbortSignal, onLine?: (line: string) => void) {
    return new Promise<{ stderr: string }>((resolve, reject) => {
      const child = spawn(this.#ffmpeg, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      let stderr = "";
      const kill = () => child.kill();
      signal.addEventListener("abort", kill, { once: true });
      if (onLine) createInterface({ input: child.stdout }).on("line", onLine);
      else child.stdout.resume();
      child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
      child.once("error", (error) => {
        signal.removeEventListener("abort", kill);
        reject(error);
      });
      child.once("close", (code) => {
        signal.removeEventListener("abort", kill);
        if (code === 0) resolve({ stderr });
        else reject(new Error(lastLine(stderr) || `ffmpeg exited with code ${code}`));
      });
    });
  }
}

const lastLine = (text: string) => text.trim().split(/\r?\n/).at(-1) ?? "";

// ---------------------------------------------------------------- wasm

/** The part of @ffmpeg.wasm/main used here. */
export interface WasmFFmpeg {
  load(): Promise<void>;
  isLoaded(): boolean;
  run(...args: string[]): Promise<void>;
  FS(method: "writeFile", name: string, data: Uint8Array): void;
  FS(method: "readFile", name: string): Uint8Array;
  FS(method: "unlink", name: string): void;
  setProgress(progress: (progress: { ratio: number }) => void): void;
  setLogger(logger: (log: { type: string; message: string }) => void): void;
  exit(): void;
}

export interface WasmOptions {
  /** Creates an instance (`createFFmpeg` with the core's path). */
  create(): Promise<WasmFFmpeg>;
}

const lyricsFrame = (text: string) => ({ language: "eng", text });

/** An MP3's lyrics as the USLT frame players read. */
export async function addMp3Lyrics(file: Buffer, lyrics: string): Promise<Buffer> {
  const { default: NodeID3 } = await import("node-id3");
  const tagged = NodeID3.update({ unsynchronisedLyrics: lyricsFrame(lyrics) }, file);
  if (tagged instanceof Error) throw tagged;
  return tagged;
}

/** MP3 tags as pear-desktop wrote them after ffmpeg.wasm: with node-id3. */
export async function tagMp3(file: Buffer, tags: Tags, cover: Cover | undefined, extra: Record<string, string> = {}): Promise<Buffer> {
  const { default: NodeID3 } = await import("node-id3");
  const id3: Id3Tags = { title: tags.title };
  if (tags.artist) id3.artist = tags.artist;
  if (tags.album) id3.album = tags.album;
  if (tags.albumArtist) id3.performerInfo = tags.albumArtist;
  if (tags.year) id3.year = String(tags.year);
  if (tags.track) id3.trackNumber = tags.trackCount ? `${tags.track}/${tags.trackCount}` : String(tags.track);
  if (tags.lyrics) id3.unsynchronisedLyrics = lyricsFrame(tags.lyrics);
  const userTags = Object.entries(extra).map(([description, value]) => ({ description, value }));
  if (userTags.length > 0) id3.userDefinedText = userTags;
  if (cover) {
    const FRONT_COVER = 3;
    id3.image = { mime: "image/jpeg", type: { id: FRONT_COVER }, description: "Cover", imageBuffer: cover.data };
  }
  const tagged = NodeID3.write(id3, file);
  if (tagged instanceof Error) throw tagged;
  return tagged;
}

/** Converts with ffmpeg.wasm, one job at a time; its files live in memory. */
export class WasmConverter implements Converter {
  readonly kind = "wasm";
  readonly #options: WasmOptions;
  #instance: Promise<WasmFFmpeg> | undefined;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(options: WasmOptions) {
    this.#options = options;
  }

  convert(job: ConvertJob) {
    const run = this.#queue.then(() => this.#convert(job));
    this.#queue = run.catch(() => {});
    return run;
  }

  async #convert(job: ConvertJob) {
    job.signal.throwIfAborted();
    const ffmpeg = await this.#ffmpeg();
    const names = { input: "input", metadata: "metadata.txt", cover: "cover.jpg", output: `output.${job.ext}` };
    const mp3 = job.ext === "mp3";
    ffmpeg.FS("writeFile", names.input, await readFile(job.input));
    try {
      const loudness = job.replayGain ? parseLoudness(await this.#run(ffmpeg, ["-i", names.input, ...LOUDNESS_ARGS], job, () => {})) : undefined;
      // MP3 tags come from node-id3 afterwards.
      const metadata = mp3 ? metadataOf({ title: job.tags.title }, job.ext) : metadataFor(job, loudness);
      ffmpeg.FS("writeFile", names.metadata, new TextEncoder().encode(ffmetadata(metadata)));
      const cover = !mp3 && job.cover && job.ext !== "opus";
      if (cover) ffmpeg.FS("writeFile", names.cover, job.cover!.data);
      const args = ffmpegArgs({
        input: names.input,
        metadataFile: names.metadata,
        coverFile: cover ? names.cover : undefined,
        output: names.output,
        ext: job.ext,
        codecArgs: job.codecArgs,
      });
      const log = await this.#run(ffmpeg, args, job, (ratio) => job.onProgress(ratio));
      let data: Uint8Array;
      try {
        data = ffmpeg.FS("readFile", names.output);
      } catch {
        throw new Error(lastLine(log) || "ffmpeg.wasm couldn't convert the song");
      }
      const extra = loudness ? loudnessTags(job.ext, loudness) : {};
      const file = mp3 ? await tagMp3(Buffer.from(data), job.tags, job.cover, extra) : data;
      await writeFile(job.output, file);
    } finally {
      for (const name of Object.values(names)) {
        try {
          ffmpeg.FS("unlink", name);
        } catch {
          // Not written.
        }
      }
    }
  }

  /** Runs a command, resolving with its log (ffmpeg.wasm resolves even when ffmpeg fails). */
  async #run(ffmpeg: WasmFFmpeg, args: string[], job: ConvertJob, onProgress: (ratio: number) => void) {
    let log = "";
    ffmpeg.setLogger(({ type, message }) => {
      if (type === "fferr") log += `${message}\n`;
    });
    ffmpeg.setProgress(({ ratio }) => onProgress(Math.max(0, Math.min(1, ratio))));
    // ffmpeg.wasm can't stop a command; exiting drops the instance, and the next job loads a new one.
    const abort = () => {
      this.#instance = undefined;
      ffmpeg.exit();
    };
    job.signal.addEventListener("abort", abort, { once: true });
    try {
      await ffmpeg.run(...args);
      job.signal.throwIfAborted();
      return log;
    } finally {
      job.signal.removeEventListener("abort", abort);
    }
  }

  #ffmpeg() {
    this.#instance ??= this.#options.create().then(async (ffmpeg) => {
      if (!ffmpeg.isLoaded()) await ffmpeg.load();
      return ffmpeg;
    });
    const instance = this.#instance;
    instance.catch(() => {
      if (this.#instance === instance) this.#instance = undefined;
    });
    return instance;
  }
}

// ---------------------------------------------------------------- choice

/** Native ffmpeg when there is one, ffmpeg.wasm otherwise; a native one that won't start falls back to wasm. */
export function chooseConverter(nativeFfmpeg: string | undefined, wasm: () => Converter): Converter {
  if (!nativeFfmpeg) return wasm();
  const native = new NativeConverter(nativeFfmpeg);
  return {
    kind: "native",
    async convert(job) {
      try {
        await native.convert(job);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT" && (error as NodeJS.ErrnoException).code !== "EACCES") throw error;
        await wasm().convert(job);
      }
    },
  };
}
