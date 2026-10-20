// pear-desktop's "Download" entry in YTM's menus of songs, albums and playlists
// (anywhere, without playing them).

import { popupMenuItem } from "@pear/sdk/dom";
import { type DownloadTarget, menuTarget } from "../ytdlp.ts";
import { type StartDownload, targetLabel } from "./options.ts";
import { type Ctx, ICON } from "./types.ts";

export function popupEntry(ctx: Ctx, start: StartDownload) {
  // What the open menu is about, read from its links.
  let target: DownloadTarget | undefined;
  popupMenuItem(ctx, {
    class: "pear-dl-item",
    icon: ICON,
    label: ctx.t("plugins.downloader.templates.button", "Download"),
    // YTM fills the links in after the menu opens.
    attributes: ["href"],
    when: (listbox) => {
      const links = listbox.querySelectorAll<HTMLAnchorElement>("a[href]");
      target = menuTarget([...links].map((link) => link.getAttribute("href") ?? ""));
      return target !== undefined;
    },
    onClick: () => {
      if (target) start(target, targetLabel(ctx, target));
    },
  });
}
