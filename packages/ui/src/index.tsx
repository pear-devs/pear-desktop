// The in-page settings overlay and its "Settings" entry in YTM's
// sidebar. Both render into shadow roots so YTM's styles can't leak in and
// ours can't leak out.

import { containScroll, shadowHost, sidebarEntry } from "@pear/sdk/dom";
import type { Translate } from "@pear/sdk/i18n";
import { render } from "preact";
import { ICON_PATHS } from "./icons.tsx";
import { Settings, type SettingsModel } from "./settings.tsx";
import { UI_STRINGS } from "./strings.ts";
import { overlayStyles } from "./styles.ts";

export { HostState, type SettingsModel, setMessage, settingsModel } from "./model.ts";

export interface SettingsController {
  open(): void;
  close(): void;
  toggle(): void;
  readonly isOpen: boolean;
}

export function mountSettings(model: SettingsModel): SettingsController {
  let container: HTMLElement | undefined;
  let isOpen = false;
  let returnFocus: Element | null = null;

  const close = () => {
    if (!isOpen) return;
    isOpen = false;
    if (container) render(null, container);
    if (returnFocus instanceof HTMLElement) returnFocus.focus();
  };
  const open = () => {
    if (isOpen) return;
    // Built on first open: nothing to pay for at startup.
    container ??= createOverlay(close);
    isOpen = true;
    returnFocus = document.activeElement;
    render(<Settings model={model} onClose={close} />, container);
  };
  const toggle = () => (isOpen ? close() : open());

  document.addEventListener(
    "keydown",
    (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === ",") {
        event.preventDefault();
        toggle();
      }
    },
    true,
  );

  mountSidebarEntries(open, model.t);
  return {
    get isOpen() {
      return isOpen;
    },
    open,
    close,
    toggle,
  };
}

/** The overlay's shadow host, in <body>; returns the element the dialog renders into. */
function createOverlay(close: () => void) {
  const { host, root } = shadowHost("pear-settings", overlayStyles);
  const container = document.createElement("div");
  root.append(container);
  // Keep YTM's global shortcuts (space, j/k, …) from firing while typing here.
  for (const type of ["keydown", "keyup", "keypress"]) host.addEventListener(type, (event) => event.stopPropagation());
  host.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });
  // The page behind doesn't scroll either: over the scrim, or past the end of the dialog's lists.
  containScroll(host);
  document.body.append(host);
  return container;
}

/** A "Settings" entry at the end of the sidebar's primary section, in both the full and the mini guide. */
function mountSidebarEntries(open: () => void, t: Translate) {
  // The core's entry lives as long as the page.
  const page = { onCleanup() {} };
  sidebarEntry(page, {
    name: "settings",
    label: t("settings-ui.title", UI_STRINGS["settings-ui.title"]),
    icon: ICON_PATHS.settings,
    title: t("settings-ui.open-hint", UI_STRINGS["settings-ui.open-hint"]),
    ariaLabel: t("settings-ui.open", UI_STRINGS["settings-ui.open"]),
    onClick: open,
  });
}
