// The page side: the title-bar styling, the menu and the window buttons in YTM's top bar.

import type { PageContextOf } from "@pear/sdk";
import type { inAppMenuConfig } from "./config.ts";
import { AppMenu } from "./menu.tsx";
import { pageStyles } from "./styles.ts";
import type { MenuCommands, WindowState } from "./types.ts";
import { windowControls } from "./window-controls.tsx";

export type Ctx = PageContextOf<typeof inAppMenuConfig, MenuCommands>;

/** Room for the native window buttons drawn over the top bar, by platform. */
const NATIVE_BUTTONS_CLASS: Partial<Record<string, string>> = {
  darwin: "pear-traffic-lights",
  win32: "pear-caption-buttons",
};

export async function startPage(ctx: Ctx) {
  ctx.addStyle(pageStyles);
  const state = await ctx.host.invoke("state");
  markTitleBar(ctx, state);

  const menu = new AppMenu(ctx);
  const showControls = state.frameless && state.platform === "linux" && ctx.config.windowControls;
  const controls = showControls ? windowControls(ctx) : undefined;
  controls?.showMaximized(state.maximized);
  ctx.host.on("state", (next) => controls?.showMaximized((next as WindowState).maximized));

  // YTM re-renders the nav bar on some navigations, and appends to it after us:
  // keep the menu first and the window buttons last.
  const place = () => {
    const left = ctx.$("nav_bar.left");
    const right = ctx.$("nav_bar.right");
    if (left && left.firstElementChild !== menu.host) left.prepend(menu.host);
    if (controls && right && right.lastElementChild !== controls.host) right.append(controls.host);
  };
  await ctx.waitFor("nav_bar.right");
  place();
  ctx.observe("nav_bar", { childList: true, subtree: true }, place);
}

/** Until a restart after enabling, the system title bar is still there: just the menu then. */
function markTitleBar(ctx: Ctx, state: WindowState) {
  const root = document.documentElement;
  const nativeButtons = NATIVE_BUTTONS_CLASS[state.platform];
  root.classList.toggle("pear-frameless", state.frameless);
  if (state.frameless && nativeButtons) root.classList.add(nativeButtons);
  ctx.onCleanup(() => root.classList.remove("pear-frameless", "pear-traffic-lights", "pear-caption-buttons"));
}
