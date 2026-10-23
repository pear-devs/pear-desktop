/** @jsxImportSource @pear/sdk */
// Page-side building blocks plugins share: icons, shadow hosts, the player-bar
// picker and entries in YTM's popup menus. Written with the DOM JSX runtime.

import type { PageContext, SelectorName } from "./index.ts";
import type { Child } from "./jsx-runtime.ts";
import { selectors } from "./selectors.ts";
import { styleSheet } from "./stylesheets.ts";

type Ctx = Pick<PageContext<unknown, {}>, "addStyle" | "onCleanup" | "listen" | "observe" | "$">;

/** A 24×24 Material-style icon from one or more SVG paths. */
export function Icon({ path }: { path: string | readonly string[] }) {
  const paths = typeof path === "string" ? [path] : path;
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {paths.map((d) => <path d={d} />)}
    </svg>
  );
}

/** A custom element with an open shadow root styled by `css`, for UIs YTM's styles mustn't reach. */
export function shadowHost(tag: string, css: string) {
  const host = document.createElement(tag);
  const root = host.attachShadow({ mode: "open" });
  root.adoptedStyleSheets = [styleSheet(css)];
  return { host, root };
}

/** Keeps key presses inside `element` from reaching YTM's keyboard shortcuts. */
export function isolateKeys(element: EventTarget, signal: AbortSignal) {
  const stop = (event: Event) => event.stopPropagation();
  for (const type of ["keydown", "keyup", "keypress"]) element.addEventListener(type, stop, { signal });
}

/** Elements kept in the page, with where each one goes; one document observer serves them all. */
const mounted = new Map<Element, (element: Element) => void>();
let stopWatching: (() => void) | undefined;

function placeDetached() {
  for (const [element, place] of mounted) {
    if (element.isConnected) continue;
    // One plugin's failing placement mustn't keep the others out.
    try {
      place(element);
    } catch (error) {
      console.error("[pear] placing an element failed", error);
    }
  }
}

/** Calls `place` whenever `element` is detached (now, and on any later DOM change). Returns a stop function. */
export function keepMounted(element: Element, place: (element: Element) => void): () => void {
  mounted.set(element, place);
  if (!element.isConnected) place(element);
  // YTM may re-render or replace whole parts of the page, so watch the document.
  stopWatching ??= observe(document, { childList: true, subtree: true }, placeDetached);
  return () => {
    if (mounted.get(element) === place) mounted.delete(element);
    if (mounted.size === 0) {
      stopWatching?.();
      stopWatching = undefined;
    }
    element.remove();
  };
}

/** A MutationObserver; returns its disconnect. */
export function observe(target: Node, options: MutationObserverInit, callback: MutationCallback): () => void {
  const observer = new MutationObserver(callback);
  observer.observe(target, options);
  return () => observer.disconnect();
}

// ---------------------------------------------------------------- player-bar picker

export interface PickerItem {
  label: string;
  checked: boolean;
  select(): void;
  /** Extra attributes for the item (e.g. `data-quality`). */
  attributes?: Record<string, string>;
}

export interface PickerOptions {
  /** Class prefix: `pear-<name>-button` and `pear-<name>-popover`. */
  name: string;
  /** The button's tooltip and accessible name. */
  label: string;
  /** The button's icon (an SVG path); leave it out to give the button text yourself. */
  icon?: string;
  heading?: string;
  /** The choices, read each time the picker opens; leave it out to fill `popover` yourself. */
  items?(): PickerItem[] | Promise<PickerItem[]>;
  /** Shown instead of the list when there are no choices. */
  empty?: string;
  /** CSS `position-area` of the popover; default "top span-left" (above, growing left). */
  position?: string;
  /** Minimum popover width in px; default 180. */
  width?: number;
  /** Stops clicks reaching YTM: needed inside the video, which treats clicks as play/pause. */
  isolateClicks?: boolean;
}

/**
 * A button that opens a menu of choices in a popover, like YTM's own pickers.
 * The popover lives in <body> (so YTM's overflow can't clip it); mount `button` where it belongs.
 * Its shared sheet is added after the plugin's `style`, so overrides name both classes:
 * `.pear-picker-popover.pear-<name>-popover { … }`.
 */
export function picker(ctx: Ctx, options: PickerOptions) {
  ctx.addStyle(PICKER_CSS);
  const anchor = `--pear-${options.name}`;
  const popover = popoverElement(options.name, "auto", "menu");
  Object.assign(popover.style, { positionAnchor: anchor, positionArea: options.position ?? "top span-left", minWidth: `${options.width ?? 180}px` });
  const button = (
    <button
      class={`pear-picker-button pear-${options.name}-button`}
      title={options.label}
      aria-label={options.label}
      aria-expanded="false"
      popoverTargetElement={popover}
      style={{ "anchor-name": anchor }}
      onClick={(event) => options.isolateClicks && event.stopPropagation()}
    >
      {options.icon && <Icon path={options.icon} />}
    </button>
  );

  const close = () => popover.hidePopover();
  const render = async () => {
    const items = (await options.items?.()) ?? [];
    const heading = options.heading && <h2>{options.heading}</h2>;
    const empty = items.length === 0 && options.empty && <p>{options.empty}</p>;
    const entries = items.map((item) => (
      <button
        role="menuitemradio"
        aria-checked={item.checked}
        {...item.attributes}
        onClick={() => {
          item.select();
          close();
        }}
      >
        {item.label}
      </button>
    ));
    popover.replaceChildren(...[heading, empty, ...entries].filter((node): node is HTMLElement => !!node));
  };
  ctx.listen(popover, "beforetoggle", (event: ToggleEvent) => {
    const open = event.newState === "open";
    if (open && options.items) void render();
    button.setAttribute("aria-expanded", String(open));
  });

  document.body.append(popover);
  ctx.onCleanup(() => {
    button.remove();
    popover.remove();
  });
  return { button, popover, close };
}

/** The popover of a picker or an anchored popover, in YTM's menu look (PICKER_CSS). */
function popoverElement(name: string, type: "auto" | "manual", role: string) {
  return <div class={`pear-picker-popover pear-${name}-popover`} popover={type} role={role} />;
}

export interface AnchoredPopoverOptions {
  /** Class prefix: `pear-<name>-popover`, next to `pear-picker-popover`. */
  name: string;
  /** Its accessible name. */
  label: string;
}

/**
 * An empty popover in the pickers' look, to fill yourself, shown next to any
 * element. It is "manual": it stays until `hide`, so the plugin decides when
 * it closes (hover, Escape, a click outside…). It lives in <body>.
 */
export function anchoredPopover(ctx: Ctx, options: AnchoredPopoverOptions) {
  ctx.addStyle(PICKER_CSS);
  const popover = popoverElement(options.name, "manual", "dialog");
  popover.setAttribute("aria-label", options.label);
  const anchorName = `--pear-${options.name}-anchor`;
  let anchor: HTMLElement | undefined;
  document.body.append(popover);
  ctx.onCleanup(() => {
    anchor?.style.removeProperty("anchor-name");
    popover.remove();
  });
  return {
    popover,
    get isOpen() {
      return popover.matches(":popover-open");
    },
    /**
     * Shows it at `position` (a CSS `position-area`) of `next`, e.g. "right span-bottom";
     * without an element, where the plugin's CSS puts it.
     */
    show(next?: HTMLElement, position = "") {
      // One element at a time carries the anchor name.
      if (anchor !== next) anchor?.style.removeProperty("anchor-name");
      anchor = next;
      anchor?.style.setProperty("anchor-name", anchorName);
      Object.assign(popover.style, { positionAnchor: anchor ? anchorName : "", positionArea: anchor ? position : "" });
      if (!popover.matches(":popover-open")) popover.showPopover();
    },
    hide() {
      if (popover.matches(":popover-open")) popover.hidePopover();
    },
  };
}

/**
 * Keeps the wheel inside `element`: scrolling over it scrolls what is under the
 * pointer, never the page behind it, even past the end.
 */
export function containScroll(element: HTMLElement, signal?: AbortSignal) {
  const onWheel = (event: WheelEvent) => {
    event.stopPropagation();
    if (!scrollsInside(event, element)) event.preventDefault();
  };
  element.addEventListener("wheel", onWheel, { passive: false, ...(signal ? { signal } : {}) });
}

/** Whether something in `boundary` under the pointer can still scroll the way the wheel turns. */
function scrollsInside(event: WheelEvent, boundary: Element) {
  const vertical = Math.abs(event.deltaY) >= Math.abs(event.deltaX);
  const delta = vertical ? event.deltaY : event.deltaX;
  for (const target of event.composedPath()) {
    if (!(target instanceof HTMLElement)) break;
    const style = getComputedStyle(target);
    if (/auto|scroll/.test(vertical ? style.overflowY : style.overflowX)) {
      const position = vertical ? target.scrollTop : target.scrollLeft;
      const room = vertical ? target.scrollHeight - target.clientHeight : target.scrollWidth - target.clientWidth;
      if (delta < 0 ? position > 0 : position < room - 1) return true;
    }
    if (target === boundary) break;
  }
  return false;
}

const PICKER_CSS = `
  .pear-picker-button {
    width: 40px;
    height: 40px;
    padding: 8px;
    border: 0;
    border-radius: 50%;
    background: none;
    color: var(--ytmusic-text-secondary, #aaa);
    cursor: pointer;
  }
  .pear-picker-button[hidden] {
    display: none;
  }
  .pear-picker-button:hover,
  .pear-picker-button[aria-expanded="true"] {
    background: rgb(255 255 255 / 0.1);
    color: #fff;
  }
  .pear-picker-button svg {
    display: block;
    width: 24px;
    height: 24px;
    fill: currentColor;
  }
  .pear-picker-popover {
    position-try-fallbacks: flip-block, flip-inline;
    inset: auto;
    margin: 8px 0;
    max-height: 50vh;
    overflow-y: auto;
    padding: 8px 0;
    border: 0;
    border-radius: 8px;
    background: #212121;
    color: #fff;
    font: 400 14px Roboto, sans-serif;
    box-shadow: 0 4px 16px rgb(0 0 0 / 0.5);
  }
  .pear-picker-popover h2 {
    margin: 0;
    padding: 4px 16px 8px;
    color: #aaa;
    font: inherit;
    font-size: 12px;
  }
  .pear-picker-popover p {
    margin: 0;
    padding: 4px 16px;
    color: #aaa;
  }
  .pear-picker-popover [role="menuitemradio"] {
    position: relative;
    display: block;
    width: 100%;
    padding: 8px 16px 8px 36px;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .pear-picker-popover [role="menuitemradio"]:hover {
    background: rgb(255 255 255 / 0.1);
  }
  .pear-picker-popover [aria-checked="true"]::before {
    content: "✓";
    position: absolute;
    left: 14px;
  }
`;

// ---------------------------------------------------------------- popup-menu entry

export interface MenuItemOptions {
  /** Class of the entry (tests and plugin CSS find it by this). */
  class: string;
  icon: string;
  label: Child;
  /** Whether the entry belongs in the menu that just opened (its listbox). */
  when(listbox: HTMLElement): boolean;
  onClick(): void;
  /** Also re-check `when` when these attributes change (e.g. "href" as YTM fills the menu in). */
  attributes?: string[];
}

/** An entry at the top of YTM's popup menus (a track's ⋮ menu, album and playlist menus…). */
export function popupMenuItem(ctx: Ctx, options: MenuItemOptions) {
  ctx.addStyle(MENU_ITEM_CSS);
  const item = (
    <div
      class={`pear-menu-item ${options.class}`}
      role="option"
      tabIndex={-1}
      onClick={(event) => {
        event.stopPropagation();
        closePopup(item);
        options.onClick();
      }}
    >
      <Icon path={options.icon} />
      {options.label}
    </div>
  );
  const place = () => {
    const listbox = ctx.$("popup.listbox");
    if (!listbox) return;
    const wanted = options.when(listbox);
    if (wanted && item.parentElement !== listbox) listbox.prepend(item);
    else if (!wanted) item.remove();
  };
  const watch: MutationObserverInit = { childList: true, subtree: true };
  if (options.attributes) Object.assign(watch, { attributes: true, attributeFilter: options.attributes });
  ctx.observe("popup.container" satisfies SelectorName, watch, place);
  ctx.onCleanup(() => item.remove());
  return item;
}

/** Closes the YTM menu `element` sits in, the way YTM closes it itself. */
function closePopup(element: HTMLElement) {
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
  element.closest<HTMLElement & { close?(): void }>("tp-yt-iron-dropdown")?.close?.();
}

const MENU_ITEM_CSS = `
  .pear-menu-item {
    display: flex;
    align-items: center;
    gap: 16px;
    height: 48px;
    padding: 0 16px;
    color: var(--ytmusic-text-primary, #fff);
    font: 400 14px Roboto, "Noto Naskh Arabic UI", Arial, sans-serif;
    cursor: pointer;
  }
  .pear-menu-item:hover,
  .pear-menu-item:focus-visible {
    background: rgb(255 255 255 / 0.1);
    outline: none;
  }
  .pear-menu-item svg {
    width: 24px;
    height: 24px;
    fill: rgb(255 255 255 / 0.7);
  }
`;

// ---------------------------------------------------------------- sidebar entries

export interface SidebarEntryOptions {
  /** Names the entry's element, `pear-<name>-entry`. */
  name: string;
  /** The text under or next to the icon. */
  label: string;
  /** The icon (an SVG path). */
  icon: string;
  /** The tooltip; default `label`. */
  title?: string;
  /** The accessible name; default `label`. */
  ariaLabel?: string;
  onClick(): void;
}

export interface SidebarEntry {
  /** A small count or word next to the label ("" hides it). */
  setBadge(text: string): void;
  /** The entry's elements, in the full and the collapsed sidebar (only one shows at a time). */
  readonly elements: readonly HTMLElement[];
  /** Focuses the entry that shows. */
  focus(): void;
  /** Marks the entry as the current page's, as YTM marks its own (while its page shows). */
  setSelected(selected: boolean): void;
}

/** The sidebar's two layouts: the full guide and the collapsed ("mini") one. */
const GUIDES = [
  ["guide.full", false],
  ["guide.mini", true],
] as const;

/**
 * An entry at the end of YTM's sidebar's main section, like its own Home and
 * Library, in both the full and the collapsed sidebar. `owner` removes it when it
 * stops (a plugin's `ctx`).
 */
export function sidebarEntry(owner: Pick<PageContext<unknown, {}>, "onCleanup">, options: SidebarEntryOptions): SidebarEntry {
  const badges: HTMLElement[] = [];
  const elements: HTMLElement[] = [];
  const buttons: HTMLElement[] = [];
  for (const [guide, mini] of GUIDES) {
    const { host, root } = shadowHost(`pear-${options.name}-entry`, SIDEBAR_ENTRY_CSS);
    host.toggleAttribute("mini", mini);
    const badge = <span class="badge" />;
    const button = (
      <button type="button" title={options.title ?? options.label} aria-label={options.ariaLabel ?? options.label} onClick={() => options.onClick()}>
        <Icon path={options.icon} />
        <span class="label">{options.label}</span>
        {badge}
      </button>
    );
    root.append(button);
    badges.push(badge);
    elements.push(host);
    buttons.push(button);
    // YTM renders the sidebar late and again on some navigations; the entry stays in place.
    const stop = keepMounted(host, (element) => {
      const items = document.querySelector(selectors[guide])?.querySelector(selectors["guide.primary_items"]);
      items?.append(element);
    });
    owner.onCleanup(stop);
  }
  return {
    setBadge(text) {
      for (const badge of badges) badge.textContent = text;
    },
    elements,
    focus() {
      buttons.find((button) => button.getClientRects().length > 0)?.focus();
    },
    setSelected(selected) {
      for (const button of buttons) {
        if (selected) button.setAttribute("aria-current", "page");
        else button.removeAttribute("aria-current");
      }
    },
  };
}

/** Opens one of YTM's pages in place, as its own links do; `browseId` names it, e.g. "FEmusic_offline". */
export function openBrowsePage(browseId: string) {
  const detail = { endpoint: { browseEndpoint: { browseId } } };
  document.querySelector(selectors.app)?.dispatchEvent(new CustomEvent("yt-navigate", { bubbles: true, composed: true, detail }));
}

/** YTM's own look for sidebar entries. */
const SIDEBAR_ENTRY_CSS = `
  :host { display: block; }
  button {
    position: relative;
    display: flex;
    align-items: center;
    gap: 20px;
    width: 100%;
    height: 48px;
    margin: 0;
    padding: 0 14px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: #fff;
    font: 16px Roboto, system-ui, sans-serif;
    text-align: left;
    cursor: pointer;
    user-select: none;
  }
  button:hover, button[aria-current="page"] { background: rgb(255 255 255 / 0.1); }
  button:focus-visible { outline: 2px solid #d0bcff; }
  svg { flex: none; width: 24px; height: 24px; fill: currentColor; }
  .badge {
    min-width: 20px;
    height: 20px;
    margin-left: auto;
    padding: 0 6px;
    border-radius: 10px;
    background: #fff;
    color: #030303;
    font: 500 12px/20px Roboto, system-ui, sans-serif;
    text-align: center;
  }
  .badge:empty { display: none; }
  :host([mini]) button {
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    height: 64px;
    padding: 0;
    font-size: 10px;
  }
  :host([mini]) .badge {
    position: absolute;
    top: 6px;
    left: calc(50% + 6px);
    min-width: 16px;
    height: 16px;
    margin: 0;
    padding: 0 4px;
    font-size: 10px;
    line-height: 16px;
  }
`;
