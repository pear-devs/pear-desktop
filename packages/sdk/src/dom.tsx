/** @jsxImportSource @pear/sdk */
// Page-side building blocks plugins share: icons, shadow hosts, the player-bar
// picker and entries in YTM's popup menus. Written with the DOM JSX runtime.

import type { PageContext, SelectorName } from "./index.ts";
import type { Child } from "./jsx-runtime.ts";

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
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  root.adoptedStyleSheets = [sheet];
  return { host, root };
}

/** Keeps key presses inside `element` from reaching YTM's keyboard shortcuts. */
export function isolateKeys(element: EventTarget, signal: AbortSignal) {
  const stop = (event: Event) => event.stopPropagation();
  for (const type of ["keydown", "keyup", "keypress"]) element.addEventListener(type, stop, { signal });
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
 */
export function picker(ctx: Ctx, options: PickerOptions) {
  ctx.addStyle(PICKER_CSS);
  const anchor = `--pear-${options.name}`;
  const popover = (
    <div
      class={`pear-picker-popover pear-${options.name}-popover`}
      popover="auto"
      role="menu"
      style={{
        "position-anchor": anchor,
        "position-area": options.position ?? "top span-left",
        "min-width": `${options.width ?? 180}px`,
      }}
    />
  );
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
