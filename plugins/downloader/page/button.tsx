/** @jsxImportSource @pear/sdk */
// The player-bar button: a click downloads the playing song. Its ring and title
// show how downloads are going.

import { Icon } from "@pear/sdk/dom";
import type { Translate } from "@pear/sdk/i18n";
import type { JobState } from "../downloads.ts";
import type { DownloaderState } from "../host.ts";
import { setupFraction, setupTitle, visibleSetup } from "../progress.ts";
import type { SetupState } from "../tools.ts";
import { ICON } from "./types.ts";

/** What the ring shows: a download, or a conversion (pulsing). */
type Busy = { ring: "downloading" | "converting"; progress: number; title: string };

export function downloadButton(download: () => void) {
  return (
    <button class="pear-dl-button" onClick={download}>
      <Icon path={ICON} />
    </button>
  );
}

export function showState(button: HTMLElement, state: DownloaderState, t: Translate) {
  const busy = busyWith(state, t);
  const label = busy?.title ?? t("plugins.downloader.templates.button", "Download");
  if (busy) {
    button.dataset.busy = busy.ring;
    button.style.setProperty("--pear-dl-progress", String(busy.progress));
  } else {
    delete button.dataset.busy;
  }
  button.setAttribute("aria-label", label);
  button.title = label;
}

function busyWith(state: DownloaderState, t: Translate): Busy | undefined {
  const setup = visibleSetup(state.setup);
  if (setup) return installing(setup, t);
  if (state.active) return downloading(state.active, state.queued, t);
}

/** yt-dlp or ffmpeg being downloaded before the first song. */
function installing(setup: SetupState, t: Translate): Busy {
  return {
    ring: setup.stage === "downloading" ? "downloading" : "converting",
    progress: setupFraction(setup),
    title: setupTitle(setup, t),
  };
}

function downloading(job: JobState, queued: number, t: Translate): Busy {
  const more = queued > 0 ? `, ${t("plugins.downloader.progress.queued", "{{count}} more queued", { count: queued })}` : "";
  return {
    ring: job.stage === "converting" ? "converting" : "downloading",
    progress: job.progress,
    title: jobTitle(job, t) + more,
  };
}

function jobTitle(job: JobState, t: Translate) {
  const item = job.item && job.item.count > 1 ? ` (${job.item.index}/${job.item.count})` : "";
  const vars = { title: job.label + item, percent: Math.round(job.progress * 100) };
  switch (job.stage) {
    case "converting":
      return t("plugins.downloader.progress.converting", "Converting “{{title}}” – {{percent}}%", vars);
    case "starting":
      return t("plugins.downloader.progress.starting", "Starting “{{title}}”", vars);
    case "downloading":
      return t("plugins.downloader.progress.downloading", "Downloading “{{title}}” – {{percent}}%", vars);
  }
}
