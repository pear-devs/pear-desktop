/** @jsxImportSource @pear/sdk */
// The Download button of album and playlist pages, next to their Play button
// and their other buttons.

import { Icon } from "@pear/sdk/dom";
import { isAlbum } from "../ytdlp.ts";
import { listNoun, pagePlaylist, type StartDownload } from "./options.ts";
import { type Ctx, ICON } from "./types.ts";

export function pageButton(ctx: Ctx, start: StartDownload) {
  const { t } = ctx;
  const update = () => {
    const list = pagePlaylist();
    button.hidden = !list;
    if (!list) return;
    const label = isAlbum(list)
      ? t("plugins.downloader.menu.download-album", "Download album")
      : t("plugins.downloader.menu.download-playlist", "Download playlist");
    button.title = label;
    button.setAttribute("aria-label", label);
  };
  const download = () => {
    const list = pagePlaylist();
    if (!list) return;
    const title = ctx.$("browse.title")?.textContent?.trim() || listNoun(list, t);
    start({ videoId: "", playlistId: list }, title);
  };
  const button = (
    <button class="pear-dl-page-button" onClick={download}>
      <Icon path={ICON} />
    </button>
  );

  // Last, only on albums and playlists: YTM sizes the buttons before it by their position.
  ctx.mount(button, (element) => {
    const actions = ctx.$("browse.action_buttons");
    if (!actions || !pagePlaylist()) return;
    actions.append(element);
    update();
  });
  // YTM moves between pages with pushState, which keeps the header when the next page has one too.
  ctx.listen(navigation, "currententrychange", update);
}
