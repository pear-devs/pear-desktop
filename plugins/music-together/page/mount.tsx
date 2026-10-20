// The nav-bar button and the popover panel, each in its own shadow root: the
// button lives in YTM's nav bar, the panel floats over the page.

import type { PageContext, YTPlayerApi } from "@pear/sdk";
import { render } from "preact";
import { Connection } from "../connection.ts";
import type { QueueElement } from "../queue.ts";
import { Together } from "../together.ts";
import type { Permission } from "../types.ts";
import { launcherStyles, panelStyles } from "./styles.ts";
import { LauncherButton, Panel } from "./ui.tsx";

export interface TogetherConfig {
  displayName: string;
  defaultPermission: Permission;
}

export interface TogetherCommands {
  [name: string]: (...args: any[]) => unknown;
  copy(text: string): void;
}

export type Ctx = PageContext<TogetherConfig, TogetherCommands>;

function shadowHost(tag: string, css: string) {
  const host = document.createElement(tag);
  const root = host.attachShadow({ mode: "open" });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  root.adoptedStyleSheets = [sheet];
  return { host, root };
}

export function mountTogether(ctx: Ctx) {
  const t = (key: string, fallback: string, vars?: Record<string, unknown>) => ctx.t(key, fallback, vars);
  const together = new Together({
    createConnection: () => new Connection(ctx.log),
    queueElement: () => ctx.$<QueueElement>("queue"),
    player: () => ctx.player.api as YTPlayerApi | null,
    toast: (message) => ctx.toast(message),
    t,
    name: () => ctx.config.displayName,
    defaultPermission: () => ctx.config.defaultPermission,
    log: ctx.log,
  });
  const launcher = shadowHost("pear-together-button", launcherStyles);
  const overlay = shadowHost("pear-together", panelStyles);
  document.body.append(overlay.host);

  let open = false;
  let stopped = false;
  const copy = (text: string) => {
    void ctx.host.invoke("copy", text).then(
      () => ctx.toast(t("plugins.music-together.toast.id-copied", "Host ID copied to clipboard")),
      () => ctx.toast(t("plugins.music-together.toast.id-copy-failed", "Failed to copy Host ID to clipboard")),
    );
  };

  const draw = () => {
    if (stopped) return;
    render(<LauncherButton together={together} open={open} onClick={() => setOpen(!open)} />, launcher.root);
    const anchor = launcher.host.getBoundingClientRect();
    render(
      open ? (
        <div class="anchor" style={{ top: `${anchor.bottom + 8}px`, right: `${Math.max(8, innerWidth - anchor.right - 8)}px` }}>
          <Panel
            together={together}
            t={t}
            name={ctx.config.displayName}
            setName={(name) => ctx.setConfig({ displayName: name })}
            copy={copy}
            onClose={() => setOpen(false)}
          />
        </div>
      ) : null,
      overlay.root,
    );
  };
  const setOpen = (next: boolean) => {
    open = next;
    draw();
  };
  ctx.onCleanup(together.subscribe(draw));

  // Keep YTM's shortcuts (space, j/k, …) away from our inputs; Escape closes.
  for (const type of ["keydown", "keyup", "keypress"]) {
    ctx.listen(overlay.host, type, (event: KeyboardEvent) => {
      if (type === "keydown" && event.key === "Escape") setOpen(false);
      event.stopPropagation();
    });
  }
  ctx.listen(document, "pointerdown", (event: PointerEvent) => {
    const path = event.composedPath();
    if (open && !path.includes(overlay.host) && !path.includes(launcher.host)) setOpen(false);
  });
  ctx.listen(window, "resize", () => open && draw());

  // YTM re-renders its nav bar on some navigations; put the button back.
  const place = () => {
    if (launcher.host.isConnected) return;
    const container = ctx.$("nav_bar.right");
    if (!container) return;
    const settings = container.querySelector("pear-launcher");
    if (settings) settings.before(launcher.host);
    else container.prepend(launcher.host);
  };
  const observer = new MutationObserver(place);
  void ctx.waitFor("nav_bar.right").then(() => {
    observer.observe(document.body, { childList: true, subtree: true });
    place();
  });
  draw();

  ctx.onCleanup(() => {
    observer.disconnect();
    stopped = true;
    together.stop();
    render(null, launcher.root);
    render(null, overlay.root);
    launcher.host.remove();
    overlay.host.remove();
  });
  return together;
}
