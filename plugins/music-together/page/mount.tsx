// The nav-bar button and the popover panel, each in its own shadow root: the
// button lives in YTM's nav bar, the panel floats over the page.

import type { PageContextOf, YTPlayerApi } from "@pear/sdk";
import { isolateKeys, shadowHost } from "@pear/sdk/dom";
import { render } from "preact";
import { Connection } from "../connection.ts";
import type { QueueElement } from "../queue.ts";
import type { schema } from "../schema.ts";
import { Together } from "../together.ts";
import { launcherStyles, panelStyles } from "./styles.ts";
import { LauncherButton, Panel } from "./ui.tsx";

export interface TogetherCommands {
  copy(text: string): void;
}

export type Ctx = PageContextOf<typeof schema, TogetherCommands>;

/** The panel's offset from the button and from the window's edge, in px. */
const PANEL_GAP = 8;

export function mountTogether(ctx: Ctx) {
  const t = ctx.t;
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
        <div class="anchor" style={{ top: `${anchor.bottom + PANEL_GAP}px`, right: `${Math.max(PANEL_GAP, innerWidth - anchor.right - PANEL_GAP)}px` }}>
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
  isolateKeys(overlay.host, ctx.signal);
  ctx.listen(overlay.host, "keydown", (event: KeyboardEvent) => {
    if (event.key === "Escape") setOpen(false);
  });
  ctx.listen(document, "pointerdown", (event: PointerEvent) => {
    const path = event.composedPath();
    if (open && !path.includes(overlay.host) && !path.includes(launcher.host)) setOpen(false);
  });
  ctx.listen(window, "resize", () => open && draw());

  // YTM re-renders its nav bar on some navigations; put the button back (left of the settings button).
  ctx.mount(launcher.host, (host) => {
    const container = ctx.$("nav_bar.right");
    if (!container) return;
    const settings = container.querySelector("pear-launcher");
    if (settings) settings.before(host);
    else container.prepend(host);
  });
  draw();

  ctx.onCleanup(() => {
    stopped = true;
    together.stop();
    render(null, launcher.root);
    render(null, overlay.root);
    launcher.host.remove();
    overlay.host.remove();
  });
  return together;
}
