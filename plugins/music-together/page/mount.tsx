// The nav-bar button and the popover panel, each in its own shadow root: the
// button lives in YTM's nav bar, the panel and toasts float over the page.

import { render } from "preact";
import { Together, type Ctx } from "./controller.ts";
import { launcherStyles, panelStyles } from "./styles.ts";
import { LauncherButton, Panel, Toasts } from "./ui.tsx";

const TOAST_MS = 4000;

function shadowHost(tag: string, css: string) {
  const host = document.createElement(tag);
  const root = host.attachShadow({ mode: "open" });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  root.adoptedStyleSheets = [sheet];
  return { host, root };
}

export function mountTogether(ctx: Ctx) {
  const together = new Together(ctx);
  const launcher = shadowHost("pear-together-button", launcherStyles);
  const overlay = shadowHost("pear-together", panelStyles);
  document.body.append(overlay.host);

  let open = false;
  let toasts: { id: number; text: string }[] = [];
  let toastId = 0;
  let stopped = false;

  const draw = () => {
    if (stopped) return;
    render(<LauncherButton together={together} open={open} onClick={() => setOpen(!open)} />, launcher.root);
    const anchor = launcher.host.getBoundingClientRect();
    render(
      <>
        {open && (
          <div class="anchor" style={{ top: `${anchor.bottom + 8}px`, right: `${Math.max(8, innerWidth - anchor.right - 8)}px` }}>
            <Panel together={together} onClose={() => setOpen(false)} />
          </div>
        )}
        <Toasts items={toasts} />
      </>,
      overlay.root,
    );
  };
  const setOpen = (next: boolean) => {
    open = next;
    draw();
  };

  ctx.onCleanup(
    together.onToast((text) => {
      const id = ++toastId;
      toasts = [...toasts.slice(-2), { id, text }];
      draw();
      setTimeout(() => {
        toasts = toasts.filter((t) => t.id !== id);
        draw();
      }, TOAST_MS);
    }),
  );

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
}
