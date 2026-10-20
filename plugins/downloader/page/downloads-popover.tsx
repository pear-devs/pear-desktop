// The Downloads popover on the sidebar's Downloads entry (or on the player-bar
// button while the sidebar is hidden). Hovering the entry previews it; a click,
// Ctrl+J or the menus pin it open until Escape, a click outside or another click
// on the entry.

import { anchoredPopover, containScroll, isolateKeys, type SidebarEntry } from "@pear/sdk/dom";
import { render } from "preact";
import { Downloads } from "./downloads-list.tsx";
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

export function downloadsPopover(ctx: Ctx, entry: SidebarEntry, playerButton: HTMLElement) {
  const bubble = anchoredPopover(ctx, { name: "dl-downloads", label: ctx.t("plugins.downloader.downloads", "Downloads") });
  const { popover } = bubble;
  isolateKeys(popover, ctx.signal);
  containScroll(popover, ctx.signal);
  let pinned = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let returnFocus: (() => void) | undefined;

  const wait = (ms: number, then: () => void) => {
    ctx.clearTimeout(timer);
    timer = ctx.setTimeout(then, ms);
  };
  const stopWaiting = () => ctx.clearTimeout(timer);

  /**
   * Next to the entry that shows; else above the player-bar button, or above the
   * player bar when the window is too narrow for its buttons, or in the middle.
   */
  const place = () => {
    const tab = entry.elements.find(onScreen);
    if (tab) {
      popover.dataset.side = "right";
      bubble.show(tab, "right span-bottom");
      returnFocus = () => entry.focus();
      return;
    }
    returnFocus = () => playerButton.focus();
    const bar = ctx.$("player_bar");
    popover.dataset.side = "top";
    if (onScreen(playerButton)) bubble.show(playerButton, "top span-left");
    else if (bar && onScreen(bar)) bubble.show(bar, "top");
    else {
      // Nothing to point at (the player page covers the window): the middle of it.
      popover.dataset.side = "center";
      bubble.show();
    }
  };

  const open = (pin: boolean) => {
    stopWaiting();
    const wasOpen = bubble.isOpen;
    place();
    if (!wasOpen) render(<Downloads ctx={ctx} />, popover);
    if (pin && !pinned) {
      pinned = true;
      popover.querySelector<HTMLElement>("button")?.focus();
    }
  };

  const close = () => {
    stopWaiting();
    if (!bubble.isOpen) return;
    const hadFocus = popover.contains(document.activeElement);
    pinned = false;
    bubble.hide();
    // Live updates only while it shows.
    render(null, popover);
    if (hadFocus) returnFocus?.();
  };
  ctx.onCleanup(() => render(null, popover));

  // Hover: a preview, which stays while the pointer is on the entry or in the popover.
  const leave = () => {
    if (bubble.isOpen && !pinned) wait(CLOSE_GRACE_MS, close);
    else if (!bubble.isOpen) stopWaiting();
  };
  for (const element of entry.elements) {
    ctx.listen(element, "pointerenter", () => (bubble.isOpen ? stopWaiting() : wait(OPEN_DELAY_MS, () => open(false))));
    ctx.listen(element, "pointerleave", leave);
  }
  ctx.listen(popover, "pointerenter", stopWaiting);
  ctx.listen(popover, "pointerleave", leave);

  // A pinned popover closes on Escape and on a click outside it (the entry's click toggles it).
  ctx.listen(
    document,
    "keydown",
    (event: KeyboardEvent) => {
      if (event.key === "Escape" && bubble.isOpen) close();
    },
    { capture: true },
  );
  ctx.listen(
    document,
    "pointerdown",
    (event: PointerEvent) => {
      if (!pinned) return;
      const path = event.composedPath();
      if (path.includes(popover) || entry.elements.some((element) => path.includes(element))) return;
      close();
    },
    { capture: true },
  );
  // The window resized (the sidebar may have hidden or come back).
  ctx.listen(window, "resize", () => {
    if (bubble.isOpen) place();
  });

  return {
    /** Opens it pinned (Ctrl+J, the menus, a toast). */
    show: () => open(true),
    /** A click on the entry: pins the preview, or closes a pinned popover. */
    toggle: () => (pinned ? close() : open(true)),
  };
}
