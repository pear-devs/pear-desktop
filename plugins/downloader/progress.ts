// What the button and the settings say about yt-dlp or ffmpeg being installed.
// No Node imports: the page uses it too.

import type { Translate } from "@pear/sdk/i18n";
import type { SetupState } from "./tools.ts";

/** How far the download of the program is, 0–1 (0 while its size is unknown). */
export const setupFraction = (setup: SetupState) => (setup.total ? setup.received / setup.total : 0);

export function setupTitle(setup: SetupState, t: Translate) {
  const vars = { tool: setup.tool, percent: Math.round(setupFraction(setup) * 100) };
  switch (setup.stage) {
    case "extracting":
      return t("plugins.downloader.setup.extracting", "Unpacking {{tool}}…", vars);
    case "verifying":
      return t("plugins.downloader.setup.verifying", "Checking {{tool}}…", vars);
    case "downloading":
      return t("plugins.downloader.setup.downloading", "Downloading {{tool}}… {{percent}}%", vars);
  }
}

/** The install the page shows: not background updates of yt-dlp, which nothing waits for. */
export const visibleSetup = (setup: SetupState | undefined) => (setup && !setup.update ? setup : undefined);
