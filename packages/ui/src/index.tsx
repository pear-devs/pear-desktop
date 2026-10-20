// The in-page settings overlay and its "Settings" entry in YTM's
// sidebar. Both render into shadow roots so YTM's styles can't leak in and
// ours can't leak out.

import { keepMounted, shadowHost } from "@pear/sdk/dom";
import type { Translate } from "@pear/sdk/i18n";
import { selectors } from "@pear/sdk/selectors";
import { render } from "preact";
import { Icon } from "./icons.tsx";
import { Settings, type SettingsModel } from "./settings.tsx";
import { UI_STRINGS } from "./strings.ts";
import { entryStyles, overlayStyles } from "./styles.ts";

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
  host.addEventListener(
    "wheel",
    (event) => {
      event.stopPropagation();
      if (!scrollsInside(event)) event.preventDefault();
    },
    { passive: false },
  );
  document.body.append(host);
  return container;
}

/** Whether something in the overlay under the pointer can still scroll the way the wheel turns. */
function scrollsInside(event: WheelEvent) {
  const vertical = Math.abs(event.deltaY) >= Math.abs(event.deltaX);
  const delta = vertical ? event.deltaY : event.deltaX;
  for (const target of event.composedPath()) {
    if (!(target instanceof HTMLElement) || target.localName === "pear-settings") break;
    const style = getComputedStyle(target);
    if (!/auto|scroll/.test(vertical ? style.overflowY : style.overflowX)) continue;
    const position = vertical ? target.scrollTop : target.scrollLeft;
    const room = vertical ? target.scrollHeight - target.clientHeight : target.scrollWidth - target.clientWidth;
    if (delta < 0 ? position > 0 : position < room - 1) return true;
  }
  return false;
}

/** A "Settings" entry at the end of the sidebar's primary section, in both the full and the mini guide. */
function mountSidebarEntries(open: () => void, t: Translate) {
  const guides = [
    ["guide.full", false],
    ["guide.mini", true],
  ] as const;
  for (const [guide, mini] of guides) {
    // YTM renders the guides late and re-renders them on some navigations; keep the entries in place.
    keepMounted(sidebarEntry(open, t, mini), (entry) => {
      const items = document.querySelector(selectors[guide])?.querySelector(selectors["guide.primary_items"]);
      items?.append(entry);
    });
  }
}

function sidebarEntry(open: () => void, t: Translate, mini: boolean) {
  const { host, root } = shadowHost("pear-settings-entry", entryStyles);
  host.toggleAttribute("mini", mini);
  render(
    <button
      type="button"
      title={t("settings-ui.open-hint", UI_STRINGS["settings-ui.open-hint"])}
      aria-label={t("settings-ui.open", UI_STRINGS["settings-ui.open"])}
      onClick={open}
    >
      <Icon name="settings" size={24} />
      <span>{t("settings-ui.title", UI_STRINGS["settings-ui.title"])}</span>
    </button>,
    root,
  );
  return host;
}
