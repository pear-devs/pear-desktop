// Finding and probing the external tools (host only).

import { execFile } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { type Capabilities, parseProbe } from "./ytdlp.ts";

const INSTALL_HINT = "Install it from https://github.com/yt-dlp/yt-dlp#installation or set its path in the plugin settings.";

export const expandHome = (path: string) => (path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(1)) : path);

function isExecutable(path: string) {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** PATH lookup, plus the usual per-user install locations apps launched from a desktop don't have on PATH. */
export function findExecutable(name: string): string | undefined {
  const extensions = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  const dirs = [
    ...(process.env.PATH ?? "").split(delimiter),
    join(homedir(), ".local", "bin"),
    "/usr/local/bin",
    "/opt/homebrew/bin",
    "/usr/bin",
  ].filter(Boolean);
  for (const dir of new Set(dirs)) {
    for (const extension of extensions) {
      const candidate = join(dir, name + extension.toLowerCase());
      if (isExecutable(candidate)) return candidate;
    }
  }
  return undefined;
}

export function resolveYtDlp(configured: string): string {
  const path = expandHome(configured.trim());
  if (path) {
    const resolved = isAbsolute(path) ? path : findExecutable(path);
    if (!resolved || !isExecutable(resolved)) throw new Error(`yt-dlp was not found at "${configured}". ${INSTALL_HINT}`);
    return resolved;
  }
  const found = findExecutable("yt-dlp");
  if (!found) throw new Error(`yt-dlp was not found on this computer. ${INSTALL_HINT}`);
  return found;
}

/** Asks yt-dlp what it can use (its verbose header lists ffmpeg and optional libraries). */
export function probe(ytDlp: string, ffmpegLocation: string): Promise<Capabilities> {
  const args = ["-v", "--ignore-config", ...(ffmpegLocation ? ["--ffmpeg-location", ffmpegLocation] : [])];
  return new Promise((resolve, reject) => {
    // Without a URL yt-dlp exits with an error after printing the header; that's expected.
    execFile(ytDlp, args, { timeout: 20_000, windowsHide: true }, (error, stdout, stderr) => {
      const output = `${stdout}\n${stderr}`;
      if (!output.includes("[debug]")) {
        reject(new Error(`could not run yt-dlp (${ytDlp}): ${error?.message ?? "no output"}`));
        return;
      }
      resolve(parseProbe(output));
    });
  });
}
