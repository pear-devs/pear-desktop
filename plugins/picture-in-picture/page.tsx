/** @jsxImportSource @pear/sdk */
// The page side: YTM's full-screen player while in the small window, the hotkey
// and the entry in the track's menu.

import type { PageContextOf } from "@pear/sdk";
import { matchesAccelerator } from "@pear/sdk/accelerator";
import { popupMenuItem } from "@pear/sdk/dom";
import type { PipCommands, pipConfig } from "./config.ts";

type Ctx = PageContextOf<typeof pipConfig, PipCommands>;
type Player = HTMLElement & { onDoubleClick_?: (() => void) | undefined };

const PIP_ICON =
  "M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z";
// The popup menu that opens right after a click on the player bar's menu button is the track's menu.
const MENU_CLICK_WINDOW_MS = 2000;
// YTM's own clean-up after its full screen happens within this.
const SETTLE_MS = 500;

export function startPage(ctx: Ctx) {
  const mode = fullScreenMode(ctx);
  ctx.host.on("pip", (active) => mode.set(active === true));
  void ctx.host.invoke("active").then((active) => mode.set(active === true));
  // Leaving YTM's full screen (its button, or Escape) leaves the small window too.
  ctx.listen(document, "fullscreenchange", () => {
    if (mode.active && !document.fullscreenElement) void ctx.host.invoke("exit");
  });

  const toggle = () => togglePip(ctx);
  handleKeys(ctx, mode, toggle);
  trackMenuEntry(ctx, toggle);
}

/** The browser's picture-in-picture when wanted and possible, else the small window. */
async function togglePip(ctx: Ctx) {
  if (ctx.config.useNativePiP) {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await ctx.player.video()?.requestPictureInPicture();
      return;
    } catch (error) {
      ctx.log.warn("native picture-in-picture failed; shrinking the window instead", error);
    }
  }
  await ctx.host.invoke("toggle");
}

/**
 * The small window shows YTM's own full-screen player; the window is not
 * full-screenable meanwhile, so it fills just the small window.
 */
function fullScreenMode(ctx: Ctx) {
  const root = document.documentElement;
  const dragStrip = <div class="pear-pip-drag" />;
  // As pear-desktop: double-clicking the video doesn't leave full screen (and so the small
  // window), and the expanding menu closes once the pointer leaves it.
  let doubleClick: { player: Player; original: (() => void) | undefined } | undefined;
  const closeMenu = () => ctx.$("player_bar.middle_controls")?.click();

  const enter = () => {
    const fullscreen = ctx.$("player.container")?.getAttribute("player-ui-state") === "FULLSCREEN";
    // YTM's full-screen player lives on the player page.
    if (!ctx.$("player.page_open")) ctx.$("player_bar.toggle_player_page")?.click();
    if (!fullscreen) ctx.$("player.fullscreen_button")?.click();
    document.body.append(dragStrip);
    const player = ctx.$<Player>("player.container");
    if (player && !doubleClick) {
      doubleClick = { player, original: player.onDoubleClick_ };
      player.onDoubleClick_ = () => {};
    }
    ctx.$("player_bar.expanding_menu")?.addEventListener("mouseleave", closeMenu);
  };
  const leave = () => {
    dragStrip.remove();
    if (doubleClick) {
      doubleClick.player.onDoubleClick_ = doubleClick.original;
      doubleClick = undefined;
    }
    ctx.$("player_bar.expanding_menu")?.removeEventListener("mouseleave", closeMenu);
    if (document.fullscreenElement) void document.exitFullscreen();
    ctx.setTimeout(revealBars, SETTLE_MS);
  };
  // The new player bar's layout hides the nav bar and the player bar (inline
  // visibility) in full screen; left in the small window, it doesn't show them again.
  const revealBars = () => {
    if (document.fullscreenElement) return;
    for (const name of ["nav_bar", "player_bar"] as const) {
      const bar = ctx.$(name);
      if (bar?.style.visibility === "hidden") bar.style.removeProperty("visibility");
    }
  };

  const mode = {
    active: false,
    set(active: boolean) {
      mode.active = active;
      root.classList.toggle("pear-pip", active);
      if (active) enter();
      else leave();
    },
  };
  ctx.onCleanup(() => {
    if (mode.active) mode.set(false);
    root.classList.remove("pear-pip");
  });
  return mode;
}

function isEditable(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  const editable = target instanceof HTMLElement && target.isContentEditable;
  return editable || !!target.closest("input, textarea, select");
}

function handleKeys(ctx: Ctx, mode: { readonly active: boolean }, toggle: () => void) {
  const isMac = navigator.platform.startsWith("Mac");
  const onKeydown = (event: KeyboardEvent) => {
    if (isEditable(event.target)) return;
    if (mode.active && event.key === "Escape") {
      // Not YTM's own Escape too: it would leave its full screen while the window is still
      // small, which breaks the new player bar's layout. The host leaves it after resizing.
      event.preventDefault();
      event.stopPropagation();
      void ctx.host.invoke("exit");
      return;
    }
    // YTM's "f" would leave full screen and break the small window.
    const hasModifier = event.ctrlKey || event.metaKey || event.altKey;
    if (mode.active && event.key.toLowerCase() === "f" && !hasModifier) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!matchesAccelerator(event, ctx.config.hotkey, isMac)) return;
    event.preventDefault();
    toggle();
  };
  ctx.listen(window, "keydown", onKeydown, { capture: true });
}

/** A "Picture in picture" entry in the current track's menu. */
function trackMenuEntry(ctx: Ctx, toggle: () => void) {
  let menuClickedAt = 0;
  const onClick = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(ctx.sel("player_bar.menu_button"))) menuClickedAt = Date.now();
    else if (!target?.closest(ctx.sel("popup.listbox"))) menuClickedAt = 0;
  };
  ctx.listen(document, "click", onClick, { capture: true });

  popupMenuItem(ctx, {
    class: "pear-pip-item",
    icon: PIP_ICON,
    label: ctx.t("plugins.picture-in-picture.templates.button", "Picture-in-picture"),
    when: () => Date.now() - menuClickedAt < MENU_CLICK_WINDOW_MS,
    onClick: toggle,
  });
}
