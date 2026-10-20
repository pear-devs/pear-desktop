// The in-page settings overlay and its "Settings" entry in YTM's
// sidebar. Both render into shadow roots so YTM's styles can't leak in and
// ours can't leak out.

import { selectors } from "@pear/sdk/selectors";
import { render } from "preact";
import { Icon } from "./icons.tsx";
import { Settings, type SettingsModel } from "./settings.tsx";
import { entryStyles, overlayStyles } from "./styles.ts";

export type { SettingsModel } from "./model.ts";

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
    root.adoptedStyleSheets = [sheet(overlayStyles)];
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

  mountSidebarEntries(controller);
  return controller;
}

function sheet(css: string) {
  const style = new CSSStyleSheet();
  style.replaceSync(css);
  return style;
}

/** A "Settings" entry at the end of the sidebar's primary section, in both the full and the mini guide. */
function mountSidebarEntries(controller: SettingsController) {
  const entries = new Map<string, HTMLElement>();
  const create = (mini: boolean) => {
    const host = document.createElement("pear-settings-entry");
    host.toggleAttribute("mini", mini);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.adoptedStyleSheets = [sheet(entryStyles)];
    render(
      <button type="button" title="Pear Desktop settings (Ctrl+,)" aria-label="Pear Desktop settings" onClick={() => controller.open()}>
        <Icon name="settings" size={24} />
        <span>Settings</span>
      </button>,
      shadow,
    );
    return host;
  };
  // YTM renders the guides late and re-renders them on some navigations; keep the entries in place.
  const place = () => {
    for (const [name, mini] of [["guide.full", false], ["guide.mini", true]] as const) {
      const items = document.querySelector(selectors[name])?.querySelector(selectors["guide.primary_items"]);
      if (!items) continue;
      let entry = entries.get(name);
      if (entry?.parentElement === items) continue;
      entry ??= create(mini);
      entries.set(name, entry);
      items.append(entry);
    }
  };
  place();
  new MutationObserver(place).observe(document.body, { childList: true, subtree: true });
}
