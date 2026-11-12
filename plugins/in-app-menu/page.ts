// The page side: pear-desktop's title bar above YTM (the menus, the window buttons) and the
// styling that makes room for it.

import type { PageContextOf } from "@pear/sdk";
import type { inAppMenuConfig } from "./config.ts";
import { TitleBar } from "./menu.tsx";
import { pageStyles } from "./styles.ts";
import type { MenuCommands, WindowState } from "./types.ts";
import { windowControls } from "./window-controls.tsx";

export type Ctx = PageContextOf<typeof inAppMenuConfig, MenuCommands>;

/** Above this, YTM's nav bar shows its background (the layout scrolls instead of the page). */
const SCROLLED = 20;

export async function startPage(ctx: Ctx) {
  ctx.addStyle(pageStyles);
  const state = await ctx.host.invoke("state");

  const showControls = state.frameless && state.platform === "linux" && ctx.config.windowControls;
  const controls = showControls ? windowControls(ctx) : undefined;
  controls?.showMaximized(state.maximized);
  ctx.host.on("state", (next) => controls?.showMaximized((next as WindowState).maximized));

  // Until a restart after enabling, the system title bar is still there: the bar then doesn't move the window.
  // The core's "Hide the menu bar" option (not on macOS): the menus start collapsed, as in
  // pear-desktop, and follow the option when it changes.
  const hideMenu = (config: { hideMenu: boolean }) => state.platform !== "darwin" && config.hideMenu;
  let hidden = hideMenu(ctx.core("window"));
  const bar = new TitleBar(ctx, { collapsed: hidden, controls: controls?.element });
  // Only when the option itself changes (the section also holds e.g. "Always on top").
  ctx.onCoreChange("window", (config) => {
    if (hideMenu(config) === hidden) return;
    hidden = hideMenu(config);
    bar.setCollapsed(hidden);
  });
  bar.host.toggleAttribute("data-frameless", state.frameless);
  if (state.frameless && state.platform === "darwin") bar.host.toggleAttribute("data-traffic-lights", true);
  if (state.frameless && state.platform === "win32") bar.host.toggleAttribute("data-caption-buttons", true);

  ctx.mount(bar.host, (host) => document.body?.append(host));

  const layout = await ctx.waitFor("app.layout");
  ctx.listen(layout, "scroll", () => layout.classList.toggle("content-scrolled", layout.scrollTop > SCROLLED), { passive: true });
  ctx.onCleanup(() => layout.classList.remove("content-scrolled"));
}
