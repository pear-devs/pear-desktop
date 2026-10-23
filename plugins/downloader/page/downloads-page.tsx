// The site's Downloads page, as ours: the sidebar's Downloads entry opens it, its
// Library / Downloads tab bar is hidden, our entry is the highlighted one, and a
// queue above its songs shows what is downloading, waiting or failed.

import { openBrowsePage, type SidebarEntry } from "@pear/sdk/dom";
import { render } from "preact";
import { Queue } from "./downloads-list.tsx";
import type { Ctx } from "./types.ts";

/** The site's Downloads page; its views (songs, albums…) are `FEmusic_offline_<view>`. */
const DOWNLOADS_PAGE = "FEmusic_offline";
/** Set on the document while the page shows, for the plugin's style. */
const PAGE_ATTRIBUTE = "pear-dl-downloads-page";

export const onDownloadsPage = () => location.pathname.startsWith(`/browse/${DOWNLOADS_PAGE}`);

export function downloadsPage(ctx: Ctx, entry: SidebarEntry) {
  const section = document.createElement("div");
  section.className = "pear-dl-section";
  let shown = false;

  const update = () => {
    const here = onDownloadsPage();
    document.documentElement.toggleAttribute(PAGE_ATTRIBUTE, here);
    entry.setSelected(here);
    if (here === shown) return;
    shown = here;
    if (here) {
      render(<Queue ctx={ctx} />, section);
    } else {
      // Live updates only while it shows.
      render(null, section);
      section.remove();
    }
  };
  // At the top of the page's shelves, which the site draws again on some changes.
  ctx.mount(section, (element) => {
    const contents = onDownloadsPage() ? ctx.$("browse.contents") : null;
    if (contents && element.parentElement !== contents) contents.prepend(element);
  });
  ctx.listen(navigation, "currententrychange", update);
  update();
  ctx.onCleanup(() => {
    render(null, section);
    document.documentElement.removeAttribute(PAGE_ATTRIBUTE);
    entry.setSelected(false);
  });

  return {
    open: () => openBrowsePage(DOWNLOADS_PAGE),
  };
}
