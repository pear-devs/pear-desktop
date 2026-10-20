// The page part: the player-bar button with its menu, the toasts, and the entry in YTM's menus.

import { remoteErrorMessage } from "@pear/sdk/util";
import type { JobResult } from "../downloads.ts";
import type { DownloaderState } from "../host.ts";
import { type PoTokenRequest, poTokens } from "../potoken.ts";
import { visibleSetup } from "../progress.ts";
import type { DownloadTarget } from "../ytdlp.ts";
import { downloadButton, showState } from "./button.tsx";
import { buttonMenu } from "./menu.tsx";
import { menuOptions } from "./options.ts";
import { popupEntry } from "./popup-entry.ts";
import { createToast, type ShowToast } from "./toast.tsx";
import type { Ctx } from "./types.ts";

export function startPage(ctx: Ctx) {
  const { t } = ctx;
  const toast = createToast(ctx);
  let state: DownloaderState = { active: undefined, queued: 0 };

  const start = async (target: DownloadTarget | undefined, label?: string) => {
    menu.close();
    try {
      await ctx.host.invoke("download", target, label);
      if (state.active) {
        toast(t("plugins.downloader.toast.queued", "Queued “{{title}}”", { title: label ?? ctx.player.state.track?.title ?? "" }));
      }
    } catch (error) {
      toast(t("plugins.downloader.toast.cannot-download", "Can't download: {{error}}", { error: remoteErrorMessage(error) }));
    }
  };
  const startDownload = (target: DownloadTarget, label: string) => void start(target, label);

  const onButtonClick = (event: MouseEvent) => {
    event.stopPropagation();
    if (menu.isOpen()) return menu.close();
    const options = menuOptions(ctx, state, startDownload);
    if (options.length === 0) return toast(t("plugins.downloader.toast.nothing-playing", "Play something to download it"));
    // A lone song downloads right away; choices open a menu.
    if (options.length === 1 && !state.active) return options[0]!.run();
    menu.open(options);
  };
  const button = downloadButton(onButtonClick);
  const menu = buttonMenu(ctx, button);
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
  };
  ctx.host.on("state", (payload) => apply(payload as DownloaderState));
  ctx.host.on("result", (payload) => showResult(ctx, toast, payload as JobResult));
  ctx.host.invoke("state").then(apply, () => {});

  popupEntry(ctx, startDownload);

  // The built-in engine's PO tokens.
  const tokens = poTokens();
  ctx.host.handle("poToken", (request) => tokens.answer(request as PoTokenRequest));
  ctx.onCleanup(() => tokens.dispose());

  // Before the volume button; YTM may re-render or replace the player bar while starting up.
  ctx.mount(menu.root, (root) => {
    const volume = ctx.$("player_bar.volume_button");
    if (volume) volume.before(root);
    else ctx.$("player_bar.right_controls_buttons")?.prepend(root);
  });
}

function showResult(ctx: Ctx, toast: ShowToast, result: JobResult) {
  const { t } = ctx;
  if (result.cancelled) return toast(t("plugins.downloader.toast.cancelled", "Download cancelled"));
  if (result.error) return toast(t("plugins.downloader.toast.failed", "Download failed: {{error}}", { error: result.error }));
  const [file] = result.files;
  const count = result.files.length;
  const message =
    count > 1
      ? t("plugins.downloader.toast.saved-many", "Saved {{count}} songs from “{{title}}”", { count, title: result.label })
      : t("plugins.downloader.toast.saved", "Saved “{{title}}”", { title: result.label });
  const show = file ? { label: t("plugins.downloader.toast.show", "Show"), run: () => void ctx.host.invoke("reveal", file) } : undefined;
  toast(message, show);
}
