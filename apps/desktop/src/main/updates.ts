// The update check (general.autoUpdates), like pear-desktop's: shortly after
// startup, packaged builds ask GitHub for the latest release and say so when it
// is newer. Nothing is downloaded; "Download" opens the release page.

import { type BrowserWindow, dialog, net, shell } from "electron";
import type { Translate } from "@pear/sdk/i18n";
import { errorMessage } from "@pear/sdk/util";
import { comparePrerelease, compareVersions } from "./version.ts";
import { alive } from "./windows.ts";

export const RELEASES_URL = "https://github.com/pear-devs/pear-desktop/releases/latest";
const LATEST_RELEASE_API = "https://api.github.com/repos/pear-devs/pear-desktop/releases/latest";
export const CHECK_DELAY_MS = 2000;

/** The update dialog's buttons, in order. */
const OK_BUTTON = 0;
const DOWNLOAD_BUTTON = 1;
const DISABLE_BUTTON = 2;

/** Dev runs and tests (`electron .`) never check. */
export function shouldCheck({ packaged, enabled }: { packaged: boolean; enabled: boolean }) {
  return packaged && enabled;
}

/** Whether `latest` (a tag such as "v4.1.0") is newer than `current`; a release beats its own prereleases. */
export function isNewerVersion(latest: string, current: string) {
  const clean = (version: string) => version.trim().replace(/^v/i, "").split("+")[0]!;
  const prerelease = (version: string) => version.split("-").slice(1).join("-");
  const [newer, older] = [clean(latest), clean(current)];
  if (!/^\d+(\.\d+)*(-.+)?$/.test(newer)) return false;
  const release = compareVersions(newer, older);
  if (release !== 0) return release > 0;
  const [newerPre, olderPre] = [prerelease(newer), prerelease(older)];
  // Same release: the release itself is newer than any of its prereleases.
  if (!newerPre || !olderPre) return !newerPre && Boolean(olderPre);
  return comparePrerelease(newerPre, olderPre) > 0;
}

export interface Release {
  version: string;
  url: string;
}

/** The latest release if it is newer than `current`; undefined otherwise or when GitHub can't be reached. */
export async function newerRelease(current: string, fetch: (url: string, init?: RequestInit) => Promise<Response>): Promise<Release | undefined> {
  const response = await fetch(LATEST_RELEASE_API, { headers: { Accept: "application/vnd.github+json" } });
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  const release = (await response.json()) as { tag_name?: unknown; html_url?: unknown; draft?: unknown; prerelease?: unknown };
  if (typeof release.tag_name !== "string" || release.draft === true || release.prerelease === true) return undefined;
  if (!isNewerVersion(release.tag_name, current)) return undefined;
  return {
    version: release.tag_name.replace(/^v/i, ""),
    url: typeof release.html_url === "string" && release.html_url.startsWith("https://github.com/") ? release.html_url : RELEASES_URL,
  };
}

export interface UpdateCheckOptions {
  currentVersion: string;
  window: () => BrowserWindow | undefined;
  t: Translate;
  /** "Disable updates" was chosen. */
  disable(): void;
}

/** Checks once and shows pear-desktop's dialog when a newer release is out. */
export async function checkForUpdates({ currentVersion, window, t, disable }: UpdateCheckOptions) {
  let release: Release | undefined;
  try {
    release = await newerRelease(currentVersion, net.fetch);
  } catch (error) {
    console.warn("[pear] update check failed:", errorMessage(error));
    return;
  }
  if (!release) return;
  console.info(`[pear] update available: ${release.version}`);
  const options: Electron.MessageBoxOptions = {
    type: "info",
    buttons: [
      t("main.dialog.update-available.buttons.ok", "OK"),
      t("main.dialog.update-available.buttons.download", "Download"),
      t("main.dialog.update-available.buttons.disable", "Disable Updates"),
    ],
    title: t("main.dialog.update-available.title", "Update Available"),
    message: t("main.dialog.update-available.message", "A new version is available"),
    detail: t("main.dialog.update-available.detail", "A new version is available and can be downloaded at {{downloadLink}}", {
      downloadLink: release.url,
    }),
    defaultId: DOWNLOAD_BUTTON,
    cancelId: OK_BUTTON,
  };
  const parent = alive(window());
  const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
  if (response === DOWNLOAD_BUTTON) void shell.openExternal(release.url);
  else if (response === DISABLE_BUTTON) disable();
}
