// The page part: the player-bar button, the Download button of album and
// playlist pages, the Downloads entry in the sidebar with its popover and its
// page, the toasts, and the entry in YTM's menus.

import { sidebarEntry } from "@pear/sdk/dom";
import { remoteErrorMessage } from "@pear/sdk/util";
import type { JobResult } from "../downloads.ts";
import type { DownloaderState } from "../host.ts";
import { type PoTokenRequest, poTokens } from "../potoken.ts";
import { visibleSetup } from "../progress.ts";
import type { DownloadTarget } from "../ytdlp.ts";
import { downloadButton, showState } from "./button.tsx";
import type { StartDownload } from "./options.ts";
import { downloadsPage } from "./downloads-page.tsx";
import { downloadsPopover } from "./downloads-popover.tsx";
import { startOffline } from "./offline.ts";
import { pageButton } from "./page-button.tsx";
import { popupEntry } from "./popup-entry.ts";
import { createToast, type ShowToast } from "./toast.tsx";
import { type Ctx, ICON } from "./types.ts";

export function startPage(ctx: Ctx) {
  const { t } = ctx;
  const toast = createToast(ctx);
  let state: DownloaderState = { active: undefined, queued: 0 };

  const start = async (target: DownloadTarget, label: string) => {
    try {
      await ctx.host.invoke("download", target, label);
      if (state.active) toast(t("plugins.downloader.toast.queued", "Queued “{{title}}”", { title: label }));
    } catch (error) {
      toast(t("plugins.downloader.toast.cannot-download", "Can't download: {{error}}", { error: remoteErrorMessage(error) }));
    }
  };
  const startDownload: StartDownload = (target, label) => void start(target, label);
  startOffline(ctx, startDownload);

  const downloadPlaying = () => {
    const track = ctx.player.state.track;
    if (!track) return toast(t("plugins.downloader.toast.nothing-playing", "Play something to download it"));
    startDownload({ videoId: track.videoId }, track.title);
  };
  const button = downloadButton(downloadPlaying);
  const entry = sidebarEntry(ctx, {
    name: "downloader",
    label: t("plugins.downloader.downloads", "Downloads"),
    icon: ICON,
    onClick: () => openDownloads(),
  });
  const page = downloadsPage(ctx, entry);
  const openDownloads = (options?: { expanded?: boolean }) => {
    preview.close();
    page.open(options);
  };
  const preview = downloadsPopover(ctx, entry, () => openDownloads({ expanded: true }));
  // The app menu, the tray and the settings' button.
  ctx.host.on("open-downloads", () => openDownloads());
  showState(button, state, t);

  const apply = (next: DownloaderState) => {
    const previous = state.setup;
    state = next;
    // Say once per program why the first download takes a while.
    const setup = visibleSetup(next.setup);
    if (setup && setup.tool !== previous?.tool) {
      toast(t("plugins.downloader.setup.toast", "Downloading {{tool}}, which saving songs needs. This happens only once.", { tool: setup.tool }));
    }
    showState(button, state, t);
    // How many downloads are running or waiting.
    const count = (next.active ? 1 : 0) + next.queued;
    entry.setBadge(count > 0 ? String(count) : "");
  };
  ctx.host.on("state", (payload) => apply(payload as DownloaderState));
  ctx.host.on("result", (payload) => showResult(ctx, toast, payload as JobResult, () => openDownloads({ expanded: true })));
  ctx.host.invoke("state").then(apply, () => {});

  // The menu's Ctrl+J, also when the page has the keyboard (as the settings' Ctrl+,).
  ctx.listen(
    document,
    "keydown",
    (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== "j") return;
      event.preventDefault();
      openDownloads();
    },
    { capture: true },
  );

  pageButton(ctx, startDownload);
  popupEntry(ctx, startDownload);

  // The built-in engine's PO tokens.
  const tokens = poTokens();
  ctx.host.handle("poToken", (request) => tokens.answer(request as PoTokenRequest));
  ctx.onCleanup(() => tokens.dispose());

  // Before the volume button; YTM may re-render or replace the player bar while starting up.
  ctx.mount(button, (element) => {
    const volume = ctx.$("player_bar.volume_button");
    if (volume) volume.before(element);
    else ctx.$("player_bar.right_controls_buttons")?.prepend(element);
  });
}

function showResult(ctx: Ctx, toast: ShowToast, result: JobResult, openDownloads: () => void) {
  const { t } = ctx;
  if (result.cancelled) return toast(t("plugins.downloader.toast.cancelled", "Download cancelled"));
  if (result.error) {
    const downloads = { label: t("plugins.downloader.toast.downloads", "Downloads"), run: openDownloads };
    return toast(t("plugins.downloader.toast.failed", "Download failed: {{error}}", { error: result.error }), downloads);
  }
  const [file] = result.files;
  // Songs kept in the app count too; with no file to show, the Downloads page shows them.
  const count = result.files.length + (result.kept?.length ?? 0);
  const message =
    count > 1
      ? t("plugins.downloader.toast.saved-many", "Saved {{count}} songs from “{{title}}”", { count, title: result.label })
      : t("plugins.downloader.toast.saved", "Saved “{{title}}”", { title: result.label });
  const show = file
    ? { label: t("plugins.downloader.toast.show", "Show"), run: () => void ctx.host.invoke("reveal", file) }
    : { label: t("plugins.downloader.toast.downloads", "Downloads"), run: openDownloads };
  toast(message, show);
}
