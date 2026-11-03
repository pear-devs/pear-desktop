/** @jsxImportSource @pear/sdk */
// Window buttons (Linux; Windows draws native ones over the bar, macOS has traffic lights).

import { Icon, shadowHost } from "@pear/sdk/dom";
import type { Ctx } from "./page.ts";
import { shadowStyles } from "./styles.ts";
import { ICONS, type WindowAction } from "./types.ts";

export function windowControls(ctx: Ctx) {
  const run = (action: WindowAction) => void ctx.host.invoke("run", action);
  const { host, root } = shadowHost("pear-window-controls", shadowStyles);
  const button = (name: string, label: string, icon: string, action: WindowAction) => (
    <button type="button" class={name} title={label} aria-label={label} onClick={() => run(action)}>
      <Icon path={icon} />
    </button>
  );
  const maximize = button("maximize", ctx.t("plugins.in-app-menu.window.maximize", "Maximize"), ICONS.maximize, "toggleMaximize");
  root.append(
    <div class="controls">
      {button("minimize", ctx.t("plugins.in-app-menu.window.minimize", "Minimize"), ICONS.minimize, "minimize")}
      {maximize}
      {button("close", ctx.t("plugins.in-app-menu.window.close", "Close"), ICONS.close, "close")}
    </div>,
  );
  ctx.onCleanup(() => host.remove());

  /** Maximize turns into Restore while the window is maximized. */
  const showMaximized = (maximized: boolean) => {
    const label = maximized
      ? ctx.t("plugins.in-app-menu.window.restore", "Restore")
      : ctx.t("plugins.in-app-menu.window.maximize", "Maximize");
    maximize.title = label;
    maximize.setAttribute("aria-label", label);
    maximize.replaceChildren(<Icon path={maximized ? ICONS.restore : ICONS.maximize} />);
  };
  return { host, showMaximized };
}
