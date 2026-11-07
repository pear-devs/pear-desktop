// pear-desktop's "Download" entry in YTM's menus of songs, episodes, albums and
// playlists (anywhere, without playing them).

import { popupMenuItem } from "@pear/sdk/dom";
import { selectors } from "@pear/sdk/selectors";
import { type DownloadTarget, menuTarget } from "../ytdlp.ts";
import { type StartDownload, targetLabel } from "./options.ts";
import { type Ctx, ICON } from "./types.ts";

/** What a menu can be opened from: a row or card of a song, episode, album or playlist, or a page's header. */
const ROWS = [
  "ytmusic-responsive-list-item-renderer",
  "ytmusic-two-row-item-renderer",
  "ytmusic-multi-row-list-item-renderer",
  "ytmusic-player-queue-item",
  "ytmusic-responsive-header-renderer",
  "ytmusic-detail-header-renderer",
  "ytmusic-immersive-header-renderer",
].join(", ");

export function popupEntry(ctx: Ctx, start: StartDownload) {
  // What the open menu is about, and what to call it.
  let target: DownloadTarget | undefined;
  let label: string | undefined;
  // The element the menu was opened from (its ⋮ button, or a right-clicked row).
  let opener: Element | undefined;
  const remember = (event: Event) => {
    const element = event.target instanceof Element ? event.target : undefined;
    if (element && !element.closest(selectors["popup.container"])) opener = element;
  };
  ctx.listen(document, "click", remember, { capture: true });
  ctx.listen(document, "contextmenu", remember, { capture: true });

  popupMenuItem(ctx, {
    class: "pear-dl-item",
    icon: ICON,
    label: ctx.t("plugins.downloader.templates.button", "Download"),
    // YTM fills the links in after the menu opens.
    attributes: ["href"],
    when: (listbox) => {
      const track = ctx.player.state.track;
      label = undefined;
      // The player bar's menu is about the song playing (an episode's links to its podcast too).
      if (opener?.closest(selectors["player_bar.menu_button"])) {
        target = track ? { videoId: track.videoId } : undefined;
        label = track?.title;
        return target !== undefined;
      }
      const row = opener?.closest(ROWS);
      const links = listbox.querySelectorAll<HTMLAnchorElement>("a[href]");
      target = menuTarget(
        [...links].map((link) => link.getAttribute("href") ?? ""),
        [...(row?.querySelectorAll<HTMLAnchorElement>("a[href]") ?? [])].map((link) => link.getAttribute("href") ?? ""),
      );
      if (target) {
        label = rowTitle(row);
        return true;
      }
      // As pear-desktop: nothing in the menu to download, so the song playing.
      target = track ? { videoId: track.videoId } : undefined;
      return target !== undefined;
    },
    onClick: () => {
      if (target) start(target, label || targetLabel(ctx, target));
    },
  });
}

/** The title a row or header shows, for the download's label. */
function rowTitle(row: Element | null | undefined) {
  const title = row?.querySelector(".title, .song-title");
  return title?.textContent?.trim() || undefined;
}
