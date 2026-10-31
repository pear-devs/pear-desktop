import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { DownloadQueue, type QueueOptions } from "../downloads.ts";
import { YtDlpEngine, type YtDlpOptions } from "../engines/ytdlp.ts";
import {
  describeFailure,
  ffmpegSource,
  type InstallProgress,
  Installer,
  parseChecksums,
  UPDATE_INTERVAL_MS,
  updateDue,
  ytDlpAsset,
} from "../install.ts";

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "pear-dl-install-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A fake network: URL -> body. */
function network(files: Record<string, string | Buffer>) {
  const requested: string[] = [];
  const fetch = async (url: string) => {
    requested.push(url);
    const body = files[url];
    if (body === undefined) return new Response("not found", { status: 404 });
    return new Response(typeof body === "string" ? body : new Uint8Array(body), { headers: { "content-length": String(Buffer.byteLength(body)) } });
  };
  return { fetch, requested };
}

const YT_DLP = "https://github.com/yt-dlp/yt-dlp/releases/latest/download";

describe("release assets", () => {
  test("yt-dlp's standalone builds per platform", () => {
    expect(ytDlpAsset("win32", "x64")).toBe("yt-dlp.exe");
    expect(ytDlpAsset("win32", "arm64")).toBe("yt-dlp_arm64.exe");
    expect(ytDlpAsset("darwin", "arm64")).toBe("yt-dlp_macos");
    expect(ytDlpAsset("linux", "x64")).toBe("yt-dlp_linux");
    expect(ytDlpAsset("linux", "arm64")).toBe("yt-dlp_linux_aarch64");
    expect(ytDlpAsset("linux", "arm")).toBeUndefined();
  });
  test("ffmpeg builds per platform", () => {
    expect(ffmpegSource("win32", "x64")).toEqual({ kind: "ffmpeg-builds", archive: "ffmpeg-master-latest-win64-gpl-shared.zip" });
    expect(ffmpegSource("linux", "arm64")).toEqual({ kind: "ffmpeg-builds", archive: "ffmpeg-master-latest-linuxarm64-gpl.tar.xz" });
    expect(ffmpegSource("darwin", "x64")).toEqual({ kind: "martin-riedl", arch: "amd64" });
    expect(ffmpegSource("darwin", "arm64")).toEqual({ kind: "martin-riedl", arch: "arm64" });
    expect(ffmpegSource("freebsd", "x64")).toBeUndefined();
  });
});

describe("helpers", () => {
  test("parses sha256sum files", () => {
    const a = "a".repeat(64);
    const b = "B".repeat(64);
    const sums = parseChecksums(`${a}  yt-dlp\r\n${b} *yt-dlp.exe\nnot a line\n`);
    expect([...sums]).toEqual([
      ["yt-dlp", a],
      ["yt-dlp.exe", "b".repeat(64)],
    ]);
  });
  test("an update is due after a few days, or right away when never checked", () => {
    const now = 10 * UPDATE_INTERVAL_MS;
    expect(updateDue({}, now)).toBe(true);
    expect(updateDue({ ytDlp: { sha256: "x", checked: now - 1000 } }, now)).toBe(false);
    expect(updateDue({ ytDlp: { sha256: "x", checked: now - UPDATE_INTERVAL_MS } }, now)).toBe(true);
    expect(updateDue({ ytDlp: { sha256: "x", checked: now - 1000 } }, now, 500)).toBe(true);
  });
  test("recognizes being offline", () => {
    expect(describeFailure(new Error("net::ERR_INTERNET_DISCONNECTED")).offline).toBe(true);
    expect(describeFailure(new Error("net::ERR_NAME_NOT_RESOLVED")).offline).toBe(true);
    expect(describeFailure(new Error("https://x answered HTTP 500")).offline).toBe(false);
  });
});

describe("Installer", () => {
  const binary = "#!/bin/sh\necho yt-dlp\n";

  test("downloads yt-dlp, verifies it, makes it executable and skips unchanged updates", async () => {
    const dir = tempDir();
    const { fetch, requested } = network({
      [`${YT_DLP}/SHA2-256SUMS`]: `${sha256(binary)}  yt-dlp_linux\n${"0".repeat(64)}  yt-dlp.exe\n`,
      [`${YT_DLP}/yt-dlp_linux`]: binary,
    });
    const progress: (InstallProgress | undefined)[] = [];
    const installer = new Installer({
      dir,
      fetch,
      resolveRedirect: async (url) => url,
      onProgress: (p) => progress.push(p),
      platform: "linux",
      arch: "x64",
      now: () => 1000,
    });
    expect(installer.hasYtDlp).toBe(false);
    expect(await installer.installYtDlp()).toBe(true);
    expect(readFileSync(installer.ytDlpPath, "utf8")).toBe(binary);
    if (process.platform !== "win32") expect(statSync(installer.ytDlpPath).mode & 0o111).not.toBe(0);
    expect(installer.state.ytDlp).toEqual({ sha256: sha256(binary), checked: 1000 });
    expect(progress).toContainEqual({ tool: "yt-dlp", stage: "downloading", received: binary.length, total: binary.length });
    expect(progress.at(-1)).toBeUndefined();

    // Same checksum upstream: nothing to download.
    requested.length = 0;
    expect(await installer.installYtDlp()).toBe(false);
    expect(requested).toEqual([`${YT_DLP}/SHA2-256SUMS`]);
  });

  test("rejects a download whose checksum doesn't match and keeps nothing", async () => {
    const dir = tempDir();
    const { fetch } = network({
      [`${YT_DLP}/SHA2-256SUMS`]: `${sha256("something else")}  yt-dlp_linux\n`,
      [`${YT_DLP}/yt-dlp_linux`]: binary,
    });
    const installer = new Installer({ dir, fetch, resolveRedirect: async (url) => url, onProgress: () => {}, platform: "linux", arch: "x64" });
    await expect(installer.installYtDlp()).rejects.toThrow(/checksum/);
    expect(existsSync(installer.ytDlpPath)).toBe(false);
    expect(existsSync(`${installer.ytDlpPath}.download`)).toBe(false);
  });

  test("a write error fails the download instead of waiting for the disk forever", async () => {
    const dir = tempDir();
    // More than the stream buffers, so the download waits for it to drain.
    const big = Buffer.alloc(1024 * 1024, 1);
    const { fetch } = network({
      [`${YT_DLP}/SHA2-256SUMS`]: `${sha256(big)}  yt-dlp_linux\n`,
      [`${YT_DLP}/yt-dlp_linux`]: big,
    });
    const installer = new Installer({ dir, fetch, resolveRedirect: async (url) => url, onProgress: () => {}, platform: "linux", arch: "x64" });
    // The temporary file can't be written: a directory is in its place.
    mkdirSync(join(`${installer.ytDlpPath}.download`, "in-the-way"), { recursive: true });
    await expect(installer.installYtDlp()).rejects.toThrow();
    expect(existsSync(installer.ytDlpPath)).toBe(false);
  }, 5000);

  test("reports HTTP errors", async () => {
    const installer = new Installer({
      dir: tempDir(),
      fetch: network({}).fetch,
      resolveRedirect: async (url) => url,
      onProgress: () => {},
      platform: "linux",
      arch: "x64",
    });
    await expect(installer.installYtDlp()).rejects.toThrow(/SHA2-256SUMS answered HTTP 404/);
  });

  test.skipIf(process.platform === "win32")("unpacks ffmpeg and ffprobe from yt-dlp's FFmpeg build", async () => {
    // A stand-in for the real archive, with the same layout.
    const work = tempDir();
    const name = "ffmpeg-master-latest-linux64-gpl";
    mkdirSync(join(work, name, "bin"), { recursive: true });
    for (const program of ["ffmpeg", "ffprobe", "ffplay"]) writeFileSync(join(work, name, "bin", program), `#!/bin/sh\necho ${program}\n`);
    mkdirSync(join(work, name, "doc"));
    execFileSync("tar", ["-cJf", join(work, `${name}.tar.xz`), "-C", work, name]);
    const archive = readFileSync(join(work, `${name}.tar.xz`));

    const base = "https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest";
    const { fetch } = network({
      [`${base}/checksums.sha256`]: `${sha256(archive)}  ${name}.tar.xz\n`,
      [`${base}/${name}.tar.xz`]: archive,
    });
    const dir = tempDir();
    const installer = new Installer({ dir, fetch, resolveRedirect: async (url) => url, onProgress: () => {}, platform: "linux", arch: "x64" });
    await installer.installFfmpeg();
    expect(installer.hasFfmpeg).toBe(true);
    expect(readFileSync(join(installer.ffmpegDir, "ffprobe"), "utf8")).toContain("echo ffprobe");
    expect(statSync(join(installer.ffmpegDir, "ffmpeg")).mode & 0o111).not.toBe(0);
    expect(existsSync(join(dir, "ffmpeg.download"))).toBe(false);
    expect(installer.state.ffmpeg?.source).toBe(`yt-dlp/FFmpeg-Builds ${name}.tar.xz`);
  });
});

/** A queue of yt-dlp jobs. */
function queueWith(options: Pick<YtDlpOptions, "prepare" | "argsFor"> & Omit<QueueOptions, "engines">) {
  const engine = new YtDlpEngine(options);
  return new DownloadQueue({ ...options, engines: () => [engine] });
}

describe("DownloadQueue", () => {
  test("cancelling while the tools are being downloaded aborts that", async () => {
    let aborted = false;
    const results: unknown[] = [];
    const queue = queueWith({
      prepare: (signal) =>
        new Promise((_, reject) =>
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("aborted"));
          }),
        ),
      argsFor: () => {
        throw new Error("not reached");
      },
      onState: () => {},
      onResult: (result) => results.push(result),
      log: { warn: () => {} },
    });
    queue.add({ videoId: "abc" }, "Song");
    await new Promise((resolve) => setTimeout(resolve, 10));
    queue.cancelAll();
    await expect.poll(() => results).toHaveLength(1);
    expect(aborted).toBe(true);
    expect(results[0]).toMatchObject({ label: "Song", cancelled: true });
  });

  test("a failed install fails the job with its message", async () => {
    const results: { error?: string }[] = [];
    const queue = queueWith({
      prepare: () => Promise.reject(new Error("Couldn't download yt-dlp (net::ERR_INTERNET_DISCONNECTED).")),
      argsFor: () => {
        throw new Error("not reached");
      },
      onState: () => {},
      onResult: (result) => results.push(result),
      log: { warn: () => {} },
    });
    queue.add({ videoId: "abc" }, "Song");
    await expect.poll(() => results).toHaveLength(1);
    expect(results[0]!.error).toMatch(/ERR_INTERNET_DISCONNECTED/);
  });
});
