// The in-page settings overlay and its nav-bar launcher. Both render into
// shadow roots so YTM's styles can't leak in and ours can't leak out.

import { selectors } from "@pear/sdk/selectors";
import { render } from "preact";
import { PearIcon, Settings, type SettingsModel } from "./settings.tsx";
import { launcherStyles, overlayStyles } from "./styles.ts";

export type { SettingsModel } from "./settings.tsx";

export interface SettingsController {
  open(): void;
  close(): void;
  toggle(): void;
  readonly isOpen: boolean;
}

export function mountSettings(model: SettingsModel): SettingsController {
  let root: ShadowRoot | undefined;
  let container: HTMLElement | undefined;
  let isOpen = false;
  let returnFocus: Element | null = null;

  // Built lazily on first open: nothing to pay for at startup.
  const ensureRoot = () => {
    if (root) return root;
    const host = document.createElement("pear-settings");
    root = host.attachShadow({ mode: "open" });
    const style = new CSSStyleSheet();
    style.replaceSync(overlayStyles);
    root.adoptedStyleSheets = [style];
    container = document.createElement("div");
    root.append(container);
    // Keep YTM's global shortcuts (space, j/k, …) from firing while typing here.
    for (const type of ["keydown", "keyup", "keypress"]) {
      host.addEventListener(type, (event) => {
        if ((event as KeyboardEvent).key === "Escape" && type === "keydown") controller.close();
        event.stopPropagation();
      });
    }
    document.body.append(host);
    return root;
  };

  const controller: SettingsController = {
    get isOpen() {
      return isOpen;
    },
    open() {
      if (isOpen) return;
      ensureRoot();
      isOpen = true;
      returnFocus = document.activeElement;
      render(<Settings model={model} onClose={() => controller.close()} />, container!);
    },
    close() {
      if (!isOpen) return;
      isOpen = false;
      render(null, container!);
      if (returnFocus instanceof HTMLElement) returnFocus.focus();
    },
    toggle() {
      if (isOpen) controller.close();
      else controller.open();
    },
  };

  document.addEventListener(
    "keydown",
    (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === ",") {
        event.preventDefault();
        controller.toggle();
      }
    },
    true,
  );

  void mountLauncher(controller);
  return controller;
}

async function mountLauncher(controller: SettingsController) {
  const container = await waitFor(selectors["nav_bar.right"]);
  const host = document.createElement("pear-launcher");
  const root = host.attachShadow({ mode: "open" });
  const style = new CSSStyleSheet();
  style.replaceSync(launcherStyles);
  root.adoptedStyleSheets = [style];
  render(
    <button type="button" title="Pear Desktop settings (Ctrl+,)" aria-label="Pear Desktop settings" onClick={() => controller.toggle()}>
      <PearIcon size={24} />
    </button>,
    root,
  );
  container.prepend(host);
  // YTM re-renders its nav bar on some navigations; put the launcher back.
  new MutationObserver(() => {
    if (!host.isConnected) document.querySelector(selectors["nav_bar.right"])?.prepend(host);
  }).observe(document.body, { childList: true, subtree: true });
}

function waitFor(selector: string): Promise<Element> {
  return new Promise((resolve) => {
    const check = () => {
      const element = document.querySelector(selector);
      if (!element) return false;
      resolve(element);
      return true;
    };
    if (check()) return;
    const observer = new MutationObserver(() => check() && observer.disconnect());
    observer.observe(document, { childList: true, subtree: true });
  });
}
