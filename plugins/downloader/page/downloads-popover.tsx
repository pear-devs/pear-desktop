// The Downloads popover: resting the pointer on the sidebar's Downloads entry
// sums up the downloads next to it, until the pointer leaves the entry and the
// popover. A click on the entry, or its "View all", opens the Downloads page
// (downloads-page.tsx).

import { anchoredPopover, containScroll, isolateKeys, type SidebarEntry } from "@pear/sdk/dom";
import { render } from "preact";
import { onDownloadsPage } from "./downloads-page.tsx";
import { DownloadsSummary } from "./downloads-list.tsx";
import type { Ctx } from "./types.ts";

/** How long the pointer rests on the entry before the preview opens. */
const OPEN_DELAY_MS = 300;
/** How long the preview stays after the pointer leaves the entry and the popover. */
const CLOSE_GRACE_MS = 300;

/** Whether an element is laid out inside the window (YTM moves the hidden sidebar off screen). */
function onScreen(element: HTMLElement) {
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.height > 0 && box.right > 0 && box.left < innerWidth;
}

export function downloadsPopover(ctx: Ctx, entry: SidebarEntry, viewAll: () => void) {
  const bubble = anchoredPopover(ctx, { name: "dl-downloads", label: ctx.t("plugins.downloader.downloads", "Downloads") });
  const { popover } = bubble;
  isolateKeys(popover, ctx.signal);
  containScroll(popover, ctx.signal);
  popover.dataset.side = "right";
  let timer: ReturnType<typeof setTimeout> | undefined;

  const wait = (ms: number, then: () => void) => {
    ctx.clearTimeout(timer);
    timer = ctx.setTimeout(then, ms);
  };
  const stopWaiting = () => ctx.clearTimeout(timer);

  const open = () => {
    stopWaiting();
    // The page itself shows them.
    const tab = entry.elements.find(onScreen);
    if (!tab || onDownloadsPage()) return;
    const wasOpen = bubble.isOpen;
    bubble.show(tab, "right span-bottom");
    if (!wasOpen) render(<DownloadsSummary ctx={ctx} onViewAll={viewAll} />, popover);
  };

  const close = () => {
    stopWaiting();
    if (!bubble.isOpen) return;
    bubble.hide();
    // Live updates only while it shows.
    render(null, popover);
  };
  ctx.onCleanup(() => render(null, popover));

  // It stays while the pointer is on the entry or in the popover.
  const leave = () => {
    if (bubble.isOpen) wait(CLOSE_GRACE_MS, close);
    else stopWaiting();
  };
  for (const element of entry.elements) {
    ctx.listen(element, "pointerenter", () => (bubble.isOpen ? stopWaiting() : wait(OPEN_DELAY_MS, open)));
    ctx.listen(element, "pointerleave", leave);
  }
  ctx.listen(popover, "pointerenter", stopWaiting);
  ctx.listen(popover, "pointerleave", leave);
  ctx.listen(
    document,
    "keydown",
    (event: KeyboardEvent) => {
      if (event.key === "Escape" && bubble.isOpen) close();
    },
    { capture: true },
  );

  return { close };
}
