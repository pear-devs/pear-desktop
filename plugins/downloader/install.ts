// Downloads yt-dlp and ffmpeg for people who don't have them installed (host only).
//
// Sources, all verified against SHA-256 checksums published next to them:
//   yt-dlp          the official standalone builds (github.com/yt-dlp/yt-dlp
//                   releases, SHA2-256SUMS). They bundle mutagen, so cover art
//                   works for every format.
//   ffmpeg (Win/Linux)  yt-dlp's own FFmpeg builds (github.com/yt-dlp/FFmpeg-Builds,
//                   checksums.sha256): static or self-contained, with patches
//                   for bugs that affect yt-dlp; what yt-dlp recommends.
//   ffmpeg (macOS)  Martin Riedl's static builds (ffmpeg.martin-riedl.de):
//                   release versions, native for arm64 and x86_64, signed with
//                   an Apple Developer ID, a .sha256 next to every file. yt-dlp
//                   has no macOS build; evermeet.cx (the one ffmpeg.org links)
//                   is x86_64 only and publishes GPG signatures, no checksums.
//
// Network access is injected (Electron's session in the app) so this stays testable.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createWriteStream, existsSync, readFileSync, type WriteStream } from "node:fs";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { errorMessage } from "@pear/sdk/util";

export type Tool = "yt-dlp" | "ffmpeg";

export interface InstallProgress {
  tool: Tool;
  stage: "downloading" | "verifying" | "extracting";
  /** Bytes so far and in total (0 when unknown). */
  received: number;
  total: number;
}

export interface InstallerOptions {
  /** Where the tools go, e.g. `userData/bin`. */
  dir: string;
  fetch(url: string, init?: { signal?: AbortSignal }): Promise<Response>;
  /** Where a redirecting URL points (one hop). */
  resolveRedirect(url: string): Promise<string>;
  onProgress(progress: InstallProgress | undefined): void;
  platform?: string;
  arch?: string;
  now?: () => number;
}

/** What was installed, in `<dir>/tools.json`. */
export interface InstalledState {
  ytDlp?: { sha256: string; checked: number };
  ffmpeg?: { source: string; installed: number };
}

const YT_DLP = "https://github.com/yt-dlp/yt-dlp/releases/latest/download";
const FFMPEG_BUILDS = "https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest";
const MARTIN_RIEDL = "https://ffmpeg.martin-riedl.de";

/** yt-dlp changes often to keep up with the site; check for a new one this often. */
export const UPDATE_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000;

/** The standalone yt-dlp release asset for a platform. */
export function ytDlpAsset(platform: string, arch: string): string | undefined {
  if (platform === "win32") return { x64: "yt-dlp.exe", arm64: "yt-dlp_arm64.exe", ia32: "yt-dlp_x86.exe" }[arch];
  if (platform === "darwin") return "yt-dlp_macos"; // universal
  if (platform === "linux") return { x64: "yt-dlp_linux", arm64: "yt-dlp_linux_aarch64" }[arch];
  return undefined;
}

export type FfmpegSource =
  /** One archive with a `<name>/bin` folder holding ffmpeg and ffprobe. */
  | { kind: "ffmpeg-builds"; archive: string }
  /** A zip per program. */
  | { kind: "martin-riedl"; arch: "arm64" | "amd64" };

export function ffmpegSource(platform: string, arch: string): FfmpegSource | undefined {
  // Windows: the "shared" builds (DLLs next to the programs) are half the size of the static ones.
  const windows = { x64: "win64", arm64: "winarm64", ia32: "win32" }[arch];
  if (platform === "win32" && windows) return { kind: "ffmpeg-builds", archive: `ffmpeg-master-latest-${windows}-gpl-shared.zip` };
  const linux = { x64: "linux64", arm64: "linuxarm64" }[arch];
  if (platform === "linux" && linux) return { kind: "ffmpeg-builds", archive: `ffmpeg-master-latest-${linux}-gpl.tar.xz` };
  if (platform === "darwin" && (arch === "arm64" || arch === "x64")) return { kind: "martin-riedl", arch: arch === "x64" ? "amd64" : "arm64" };
  return undefined;
}

/** `sha256sum` output: "<hex>  <name>" (or "<hex> *<name>") per line. */
export function parseChecksums(text: string): Map<string, string> {
  const sums = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-f]{64})\s+\*?(.+?)\s*$/i.exec(line.trim());
    if (match) sums.set(match[2]!, match[1]!.toLowerCase());
  }
  return sums;
}

export const updateDue = (state: InstalledState, now: number, interval = UPDATE_INTERVAL_MS) =>
  !state.ytDlp || now - state.ytDlp.checked >= interval;

/** Turns network failures into something a person can act on. */
export function describeFailure(error: unknown): { message: string; offline: boolean } {
  const message = errorMessage(error);
  const offline = /ERR_(INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|NETWORK_CHANGED|NETWORK_IO_SUSPENDED|CONNECTION_\w+|TIMED_OUT|ADDRESS_UNREACHABLE|PROXY_\w+)|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|fetch failed/i.test(
    message,
  );
  return { message, offline };
}

/** Waits for `file` to take more data; rejects if it fails or closes instead (it would never drain). */
async function drained(file: WriteStream) {
  const closedEarly = () => file.errored ?? new Error("the file closed before the download was written");
  if (file.destroyed) throw closedEarly();
  const listening = new AbortController();
  const { signal } = listening;
  try {
    // `once` also rejects on the stream's "error".
    const closed = once(file, "close", { signal }).then(() => Promise.reject(closedEarly()));
    await Promise.race([once(file, "drain", { signal }), closed]);
  } finally {
    listening.abort();
  }
}

export class Installer {
  #options: InstallerOptions;
  #platform: string;
  #arch: string;
  #now: () => number;

  constructor(options: InstallerOptions) {
    this.#options = options;
    this.#platform = options.platform ?? process.platform;
    this.#arch = options.arch ?? process.arch;
    this.#now = options.now ?? Date.now;
  }

  get #exe() {
    return this.#platform === "win32" ? ".exe" : "";
  }

  get ytDlpPath() {
    return join(this.#options.dir, `yt-dlp${this.#exe}`);
  }

  /** Passed to yt-dlp's --ffmpeg-location. */
  get ffmpegDir() {
    return join(this.#options.dir, "ffmpeg");
  }

  get hasYtDlp() {
    return existsSync(this.ytDlpPath);
  }

  get hasFfmpeg() {
    return existsSync(join(this.ffmpegDir, `ffmpeg${this.#exe}`)) && existsSync(join(this.ffmpegDir, `ffprobe${this.#exe}`));
  }

  get supported() {
    return { ytDlp: !!ytDlpAsset(this.#platform, this.#arch), ffmpeg: !!ffmpegSource(this.#platform, this.#arch) };
  }

  get state(): InstalledState {
    try {
      return JSON.parse(readFileSync(join(this.#options.dir, "tools.json"), "utf8")) as InstalledState;
    } catch {
      return {};
    }
  }

  async #save(patch: InstalledState) {
    await writeFile(join(this.#options.dir, "tools.json"), `${JSON.stringify({ ...this.state, ...patch }, null, 2)}\n`);
  }

  /** Removes leftovers of an interrupted install or of replacing a running yt-dlp.exe. */
  async tidy() {
    await Promise.all(
      [`${this.ytDlpPath}.download`, `${this.ytDlpPath}.old`, join(this.#options.dir, "ffmpeg.download")].map((path) =>
        rm(path, { recursive: true, force: true }).catch(() => {}),
      ),
    );
  }

  /**
   * Installs the latest yt-dlp, or replaces the installed one if a newer one
   * is out. Resolves whether anything was downloaded.
   */
  async installYtDlp(signal?: AbortSignal): Promise<boolean> {
    const asset = ytDlpAsset(this.#platform, this.#arch);
    if (!asset) throw new Error(`there is no yt-dlp build for ${this.#platform} ${this.#arch}`);
    await mkdir(this.#options.dir, { recursive: true });
    const expected = (await this.#checksums(`${YT_DLP}/SHA2-256SUMS`, signal)).get(asset);
    if (!expected) throw new Error(`${asset} is missing from yt-dlp's checksums`);
    const now = this.#now();
    if (this.hasYtDlp && this.state.ytDlp?.sha256 === expected) {
      await this.#save({ ytDlp: { sha256: expected, checked: now } });
      return false;
    }
    const temporary = `${this.ytDlpPath}.download`;
    try {
      await this.#download("yt-dlp", `${YT_DLP}/${asset}`, temporary, expected, signal);
      if (this.#platform !== "win32") await chmod(temporary, 0o755);
      // A running yt-dlp.exe can't be replaced, but it can be renamed.
      if (this.#platform === "win32" && this.hasYtDlp) await rename(this.ytDlpPath, `${this.ytDlpPath}.old`).catch(() => {});
      await rename(temporary, this.ytDlpPath);
    } finally {
      await rm(temporary, { force: true });
      this.#options.onProgress(undefined);
    }
    await this.#save({ ytDlp: { sha256: expected, checked: now } });
    return true;
  }

  async installFfmpeg(signal?: AbortSignal): Promise<void> {
    const source = ffmpegSource(this.#platform, this.#arch);
    if (!source) throw new Error(`there is no ffmpeg build for ${this.#platform} ${this.#arch}`);
    const work = join(this.#options.dir, "ffmpeg.download");
    await rm(work, { recursive: true, force: true });
    await mkdir(work, { recursive: true });
    try {
      let bin: string;
      let from: string;
      if (source.kind === "ffmpeg-builds") {
        const expected = (await this.#checksums(`${FFMPEG_BUILDS}/checksums.sha256`, signal)).get(source.archive);
        if (!expected) throw new Error(`${source.archive} is missing from the FFmpeg build's checksums`);
        const archive = join(work, source.archive);
        await this.#download("ffmpeg", `${FFMPEG_BUILDS}/${source.archive}`, archive, expected, signal);
        this.#options.onProgress({ tool: "ffmpeg", stage: "extracting", received: 0, total: 0 });
        await this.#extract(archive, work, signal);
        await rm(archive, { force: true });
        bin = join(work, source.archive.replace(/\.(zip|tar\.xz)$/, ""), "bin");
        from = `yt-dlp/FFmpeg-Builds ${source.archive}`;
      } else {
        bin = join(work, "bin");
        await mkdir(bin);
        let version = "";
        for (const program of ["ffmpeg", "ffprobe"]) {
          // e.g. /download/macos/arm64/1789931890_9.0.2/ffmpeg.zip
          const url = new URL(await this.#options.resolveRedirect(`${MARTIN_RIEDL}/redirect/latest/macos/${source.arch}/release/${program}.zip`), MARTIN_RIEDL).href;
          const expected = (await this.#checksums(`${url}.sha256`, signal)).get(`${program}.zip`);
          if (!expected) throw new Error(`no checksum for ${url}`);
          const archive = join(work, `${program}.zip`);
          await this.#download("ffmpeg", url, archive, expected, signal);
          this.#options.onProgress({ tool: "ffmpeg", stage: "extracting", received: 0, total: 0 });
          await this.#extract(archive, bin, signal);
          await rm(archive, { force: true });
          version = /\/\d+_([^/]+)\/[^/]+$/.exec(url)?.[1] ?? version;
        }
        from = `ffmpeg.martin-riedl.de ${version}`.trim();
      }
      for (const program of ["ffmpeg", "ffprobe"]) {
        if (!existsSync(join(bin, `${program}${this.#exe}`))) throw new Error(`the ffmpeg download has no ${program}`);
        if (this.#platform !== "win32") await chmod(join(bin, program), 0o755);
      }
      await rm(this.ffmpegDir, { recursive: true, force: true });
      await rename(bin, this.ffmpegDir);
      await this.#save({ ffmpeg: { source: from, installed: this.#now() } });
    } finally {
      await rm(work, { recursive: true, force: true }).catch(() => {});
      this.#options.onProgress(undefined);
    }
  }

  async #get(url: string, signal: AbortSignal | undefined) {
    const response = await this.#options.fetch(url, signal ? { signal } : {});
    if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`);
    return response;
  }

  async #checksums(url: string, signal: AbortSignal | undefined) {
    return parseChecksums(await (await this.#get(url, signal)).text());
  }

  /** Streams `url` into `path`, reporting progress, and checks its SHA-256. */
  async #download(tool: Tool, url: string, path: string, sha256: string, signal: AbortSignal | undefined) {
    const response = await this.#get(url, signal);
    const total = Number(response.headers.get("content-length")) || 0;
    const hash = createHash("sha256");
    const file = createWriteStream(path);
    const closed = new Promise<void>((resolve, reject) => {
      file.once("close", resolve);
      file.once("error", reject);
    });
    // Awaited below; failing earlier (while reading) mustn't be an unhandled rejection.
    closed.catch(() => {});
    let received = 0;
    try {
      const reader = response.body!.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value);
        received += value.byteLength;
        if (!file.write(value)) await drained(file);
        this.#options.onProgress({ tool, stage: "downloading", received, total });
      }
    } finally {
      file.end();
      await closed;
    }
    this.#options.onProgress({ tool, stage: "verifying", received, total });
    const actual = hash.digest("hex");
    if (actual !== sha256) throw new Error(`the downloaded ${tool} is damaged (its checksum doesn't match); try again`);
  }

  #extract(archive: string, into: string, signal: AbortSignal | undefined) {
    // bsdtar reads zips too; Windows ships it as System32\tar.exe (unlike another tar on PATH, e.g. Git's).
    const tar = this.#platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
    return new Promise<void>((resolve, reject) => {
      execFile(tar, ["-xf", archive, "-C", into], { windowsHide: true, ...(signal ? { signal } : {}) }, (error, _stdout, stderr) =>
        error ? reject(new Error(`couldn't unpack ${archive}: ${stderr.trim() || error.message}`)) : resolve(),
      );
    });
  }
}
