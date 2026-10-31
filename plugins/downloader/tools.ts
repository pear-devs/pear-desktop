// Finding, probing and (when missing) installing the external tools (host only).
// Paths set in the settings win, then programs installed on the computer, then
// the copies this plugin downloads into the app's data folder (install.ts).

import { execFile } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import type { Translate } from "@pear/sdk/i18n";
import { errorMessage } from "@pear/sdk/util";
import { setupTitle, visibleSetup } from "./progress.ts";
import { describeFailure, type InstallProgress, type Installer, type Tool, updateDue } from "./install.ts";
import { type Capabilities, parseProbe } from "./ytdlp.ts";

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

/** Asks yt-dlp what it can use (its verbose header lists ffmpeg and optional libraries). */
export function probe(ytDlp: string, ffmpegLocation: string): Promise<Capabilities> {
  const args = ["-v", "--ignore-config", ...(ffmpegLocation ? ["--ffmpeg-location", ffmpegLocation] : [])];
  return new Promise((resolve, reject) => {
    // Without a URL yt-dlp exits with an error after printing the header; that's expected.
    // The standalone builds unpack themselves first, which can take a while on a cold start.
    execFile(ytDlp, args, { timeout: 60_000, windowsHide: true }, (error, stdout, stderr) => {
      const output = `${stdout}\n${stderr}`;
      if (!output.includes("[debug]")) {
        reject(new Error(`could not run yt-dlp (${ytDlp}): ${error?.message ?? "no output"}`));
        return;
      }
      resolve(parseProbe(output));
    });
  });
}

export type ToolSource = "configured" | "system" | "managed";

export interface ReadyTools {
  ytDlp: string;
  /** For --ffmpeg-location; empty lets yt-dlp look on PATH. */
  ffmpegPath: string;
  capabilities: Capabilities;
}

/** An install or update in progress, for the button and the settings. */
export interface SetupState extends InstallProgress {
  /** A background update of a downloaded yt-dlp (nothing waits for it). */
  update: boolean;
}

export interface ToolsOptions {
  ytDlpPath: string;
  ffmpegPath: string;
  installer: Installer;
  /** Off in tests that pretend nothing is installed. */
  systemTools: boolean;
  t: Translate;
  log: { info(...args: unknown[]): void; warn(...args: unknown[]): void };
  /** Called whenever what `describe` and `setup` say changes. */
  onChange(): void;
}

export class Tools {
  #options: ToolsOptions;
  ytDlp: { path: string; source: ToolSource } | undefined;
  ffmpeg: { location: string; source: ToolSource } | undefined;
  capabilities: Capabilities | undefined;
  /** What is being downloaded right now. */
  setup: SetupState | undefined;
  /** Why the last install failed. */
  failure: string | undefined;
  #preparing: Promise<ReadyTools> | undefined;
  #updating = false;

  constructor(options: ToolsOptions) {
    this.#options = options;
  }

  /** Finds what is there already. Throws when a path set in the settings doesn't work. */
  async init() {
    const { t, installer } = this.#options;
    await installer.tidy();
    const ytDlpPath = expandHome(this.#options.ytDlpPath.trim());
    if (ytDlpPath) {
      const resolved = isAbsolute(ytDlpPath) ? ytDlpPath : findExecutable(ytDlpPath);
      if (!resolved || !isExecutable(resolved)) {
        throw new Error(
          t(
            "plugins.downloader.errors.yt-dlp-not-found",
            "yt-dlp was not found at “{{path}}”. Correct its path in the settings, or clear it to have yt-dlp downloaded automatically.",
            { path: this.#options.ytDlpPath.trim() },
          ),
        );
      }
      this.ytDlp = { path: resolved, source: "configured" };
    } else {
      const system = this.#options.systemTools ? findExecutable("yt-dlp") : undefined;
      if (system) this.ytDlp = { path: system, source: "system" };
      else if (installer.hasYtDlp) this.ytDlp = { path: installer.ytDlpPath, source: "managed" };
    }

    const ffmpegPath = expandHome(this.#options.ffmpegPath.trim());
    if (ffmpegPath) this.ffmpeg = { location: ffmpegPath, source: "configured" };
    else {
      const ffmpeg = this.#options.systemTools ? findExecutable("ffmpeg") : undefined;
      const ffprobe = this.#options.systemTools ? findExecutable("ffprobe") : undefined;
      // Their folder also covers the per-user folders yt-dlp's own PATH lookup misses.
      if (ffmpeg && ffprobe) this.ffmpeg = { location: dirname(ffmpeg) === dirname(ffprobe) ? dirname(ffmpeg) : "", source: "system" };
      else if (installer.hasFfmpeg) this.ffmpeg = { location: installer.ffmpegDir, source: "managed" };
    }

    if (this.ytDlp && this.ffmpeg) {
      try {
        await this.#probe();
      } catch (error) {
        // A broken download is replaced on demand; anything else is the user's to fix.
        if (this.ytDlp.source !== "managed") throw error;
        this.#options.log.warn("the downloaded yt-dlp doesn't run; it will be downloaded again", error);
        await rm(this.ytDlp.path, { force: true });
        this.ytDlp = undefined;
      }
    }
    if (this.capabilities && !this.capabilities.ffmpeg) this.#forgetFfmpeg();
    this.#options.onChange();
  }

  /** The tools for a download, installing the missing ones first. */
  ready(signal?: AbortSignal): Promise<ReadyTools> {
    const current = this.#current();
    if (current) return Promise.resolve(current);
    this.#preparing ??= this.#install(signal).finally(() => (this.#preparing = undefined));
    return this.#preparing;
  }

  /** Updates a downloaded yt-dlp unless that was checked within `interval`. */
  async update(interval?: number) {
    const { installer, log } = this.#options;
    if (this.ytDlp?.source !== "managed" || this.#updating || this.#preparing) return;
    if (!updateDue(installer.state, Date.now(), interval)) return;
    await this.#update().catch((error: unknown) => log.warn("couldn't update yt-dlp:", errorMessage(error)));
  }

  /** The settings' "Update yt-dlp" button: now, and saying why not when yt-dlp isn't this plugin's to update. */
  async updateNow() {
    const { t } = this.#options;
    if (!this.ytDlp) {
      throw new Error(t("plugins.downloader.errors.update-missing", "yt-dlp isn't downloaded yet; that happens the first time it is needed."));
    }
    if (this.ytDlp.source !== "managed") {
      throw new Error(
        t("plugins.downloader.errors.update-external", "This yt-dlp is {{source}}; update it the way it was installed.", {
          source: this.#source(this.ytDlp.source),
        }),
      );
    }
    if (this.#updating || this.#preparing) return;
    await this.#update();
  }

  async #update() {
    const { installer, log } = this.#options;
    this.#updating = true;
    try {
      if (await this.#run("yt-dlp", (signal) => installer.installYtDlp(signal))) {
        await this.#probe();
        log.info(`updated yt-dlp to ${this.capabilities?.version}`);
      }
    } finally {
      this.#updating = false;
      this.#options.onChange();
    }
  }

  /** Progress from the installer. */
  progress(progress: InstallProgress | undefined) {
    this.setup = progress && { ...progress, update: this.#updating };
    this.#options.onChange();
  }

  /** The ffmpeg program to convert with, if there is one (yt-dlp is given its folder instead). */
  get ffmpegProgram(): string | undefined {
    if (!this.ffmpeg) return undefined;
    const name = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
    const { location } = this.ffmpeg;
    if (!location) return findExecutable("ffmpeg");
    return isExecutable(location) ? location : join(location, name);
  }

  /** One line for the settings: the built-in engine's, or yt-dlp's when only it downloads. */
  describe(engine: "auto" | "yt-dlp" = "yt-dlp"): string {
    const { t } = this.#options;
    const setup = visibleSetup(this.setup);
    if (setup) return setupTitle(setup, t);
    if (this.failure) return this.failure;
    if (engine === "auto") return this.#describeBuiltIn();
    const missing = [!this.ytDlp && "yt-dlp", !this.ffmpeg && "ffmpeg"].filter(Boolean) as Tool[];
    if (missing.length === 2) {
      return t(
        "plugins.downloader.setup.both-missing",
        "yt-dlp and ffmpeg aren't installed; they will be downloaded the first time you download a song.",
      );
    }
    if (missing.length === 1) {
      return t("plugins.downloader.setup.missing", "{{tool}} isn't installed; it will be downloaded the first time you download a song.", {
        tool: missing[0],
      });
    }
    const source = (which: ToolSource) => this.#source(which);
    return t("plugins.downloader.setup.ready", "Using yt-dlp {{version}} ({{ytDlpSource}}) and ffmpeg ({{ffmpegSource}}).", {
      version: this.capabilities?.version ?? "",
      ytDlpSource: source(this.ytDlp!.source),
      ffmpegSource: source(this.ffmpeg!.source),
    });
  }

  #source(which: ToolSource) {
    const { t } = this.#options;
    if (which === "configured") return t("plugins.downloader.setup.source-configured", "set in the settings");
    if (which === "system") return t("plugins.downloader.setup.source-system", "installed on this computer");
    return t("plugins.downloader.setup.source-managed", "downloaded automatically");
  }

  /** ffmpeg.wasm counts as built in; yt-dlp is the fallback, downloaded when first needed. */
  #describeBuiltIn() {
    const { t } = this.#options;
    const converter = this.ffmpeg
      ? t("plugins.downloader.setup.converter-ffmpeg", "ffmpeg ({{source}})", { source: this.#source(this.ffmpeg.source) })
      : t("plugins.downloader.setup.converter-built-in", "the built-in ffmpeg");
    const fallback = this.ytDlp
      ? t("plugins.downloader.setup.fallback-ready", "yt-dlp ({{source}}) takes over when that fails", { source: this.#source(this.ytDlp.source) })
      : t("plugins.downloader.setup.fallback-missing", "yt-dlp is downloaded when that fails");
    return t("plugins.downloader.setup.ready-built-in", "Downloading with the built-in downloader, converting with {{converter}}; {{fallback}}.", {
      converter,
      fallback,
    });
  }

  #current(): ReadyTools | undefined {
    if (!this.ytDlp || !this.ffmpeg || !this.capabilities?.ffmpeg) return undefined;
    return { ytDlp: this.ytDlp.path, ffmpegPath: this.ffmpeg.location, capabilities: this.capabilities };
  }

  async #install(signal: AbortSignal | undefined): Promise<ReadyTools> {
    const { installer, t } = this.#options;
    this.failure = undefined;
    if (!this.ytDlp) {
      await this.#run("yt-dlp", (s) => installer.installYtDlp(s), signal);
      this.ytDlp = { path: installer.ytDlpPath, source: "managed" };
      this.capabilities = undefined;
    }
    if (!this.ffmpeg) {
      await this.#run("ffmpeg", (s) => installer.installFfmpeg(s), signal);
      this.ffmpeg = { location: installer.ffmpegDir, source: "managed" };
      this.capabilities = undefined;
    }
    try {
      if (!this.capabilities) await this.#probe();
      if (!this.capabilities!.ffmpeg) {
        this.#forgetFfmpeg();
        throw new Error(t("plugins.downloader.errors.ffmpeg-broken", "yt-dlp can't use the downloaded ffmpeg."));
      }
      return this.#current()!;
    } finally {
      this.#options.onChange();
    }
  }

  /** Runs an install step, turning failures into a message for people. */
  async #run<T>(tool: Tool, step: (signal?: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const { t, installer, log } = this.#options;
    const update = this.#updating;
    if (!(tool === "yt-dlp" ? installer.supported.ytDlp : installer.supported.ffmpeg)) {
      throw new Error(
        t(
          "plugins.downloader.errors.unsupported",
          "{{tool}} can't be downloaded automatically on this computer. Install it yourself and set its path in the downloader's settings.",
          { tool },
        ),
      );
    }
    if (!update) log.info(`downloading ${tool}`);
    try {
      return await step(signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      const { message, offline } = describeFailure(error);
      log.warn(`couldn't download ${tool}:`, message);
      const failure = t("plugins.downloader.errors.install-failed", "Couldn't download {{tool}} ({{error}}).", { tool, error: message });
      const hint = offline
        ? t("plugins.downloader.errors.offline", "Check your internet connection and try again.")
        : t("plugins.downloader.errors.manual", "Try again later, or install {{tool}} yourself and set its path in the downloader's settings.", {
            tool,
          });
      if (!update) {
        this.failure = `${failure} ${hint}`;
        this.#options.onChange();
      }
      throw new Error(`${failure} ${hint}`);
    }
  }

  async #probe() {
    this.capabilities = await probe(this.ytDlp!.path, this.ffmpeg?.location ?? "");
  }

  /** An ffmpeg yt-dlp can't use: an error if it was set in the settings, else one is downloaded instead. */
  #forgetFfmpeg() {
    if (this.ffmpeg?.source === "configured") {
      throw new Error(
        this.#options.t(
          "plugins.downloader.errors.ffmpeg-not-usable",
          "yt-dlp can't use the ffmpeg at “{{path}}”. Correct its path in the settings, or clear it.",
          { path: this.#options.ffmpegPath.trim() },
        ),
      );
    }
    this.#options.log.warn(`yt-dlp can't use ffmpeg at "${this.ffmpeg?.location || "PATH"}"; it will be downloaded`);
    this.ffmpeg = undefined;
    this.capabilities = undefined;
  }
}
