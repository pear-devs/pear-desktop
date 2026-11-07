/** @jsxImportSource @pear/sdk */
// pear-desktop's title bar: a button that shows or hides the application menu's top-level
// menus, laid out side by side; a click on one opens its panel, submenus cascade from it.
// The window buttons sit at the right end.

import { Icon, isolateKeys, shadowHost } from "@pear/sdk/dom";
import { handlePanelKey, isMenuKey, opensSubmenu } from "./keyboard.ts";
import { belowTrigger, besideItem, placePanel, type Point } from "./position.ts";
import { shadowStyles } from "./styles.ts";
import { ICONS, type MenuNode } from "./types.ts";
import type { Ctx } from "./page.ts";

const ROLES: Record<MenuNode["kind"], string> = {
  normal: "menuitem",
  submenu: "menuitem",
  checkbox: "menuitemcheckbox",
  radio: "menuitemradio",
  separator: "separator",
};

/** How long the pointer rests on an item before its submenu opens (or a sibling's closes), as in pear-desktop. */
const HOVER_DELAY = 225;
/** The pointer is over the bar (shown in full screen, where it slides away). */
const SHOW_ZONE = 32;

interface Panel {
  element: HTMLElement;
  items: HTMLButtonElement[];
  /** The item that opened this submenu. */
  owner?: HTMLButtonElement;
}

export interface TitleBarOptions {
  /** The menus start hidden (the core's hideMenu option). */
  collapsed: boolean;
  /** The window buttons, at the right end. */
  controls?: HTMLElement | undefined;
}

export class TitleBar {
  readonly host: HTMLElement;
  readonly #ctx: Ctx;
  readonly #root: ShadowRoot;
  readonly #menus: HTMLElement;
  #collapsed: boolean;
  /** The top-level menus' buttons. */
  #buttons: HTMLButtonElement[] = [];
  /** The open top-level menu's button. */
  #openButton: HTMLButtonElement | undefined;
  /** Open panels, outermost first. */
  #panels: Panel[] = [];
  /** The checkable items in the open panels, by their path, to show their new state after a click. */
  #checkables = new Map<string, HTMLButtonElement>();
  #hoverTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(ctx: Ctx, options: TitleBarOptions) {
    this.#ctx = ctx;
    this.#collapsed = options.collapsed;
    const { host, root } = shadowHost("pear-title-bar", shadowStyles);
    this.host = host;
    this.#root = root;
    const label = ctx.t("plugins.in-app-menu.menu.application-menu", "Application menu");
    this.#menus = (<div class="menus" role="menubar" aria-label={label} hidden={this.#collapsed} />) as HTMLElement;
    root.append(
      <button
        type="button"
        class="icon-button toggle"
        title={label}
        aria-label={label}
        aria-expanded={String(!this.#collapsed)}
        onClick={() => this.toggleCollapsed()}
      >
        <Icon path={ICONS.menu} />
      </button>,
      this.#menus,
    );
    if (options.controls) root.append(<div class="spacer" />, options.controls);
    ctx.onCleanup(() => {
      clearTimeout(this.#hoverTimer);
      host.remove();
    });
    this.#listen();
    if (!this.#collapsed) void this.#renderMenus();
  }

  #listen() {
    const ctx = this.#ctx;
    // Keep YTM's own shortcuts (space, j/k…) out of the menu.
    isolateKeys(this.host, ctx.signal);
    ctx.listen(document, "pointerdown", (event: PointerEvent) => {
      if (!event.composedPath().includes(this.host)) this.close();
    });
    ctx.listen(window, "blur", () => this.close());
    ctx.listen(
      window,
      "keydown",
      (event: KeyboardEvent) => {
        if (!isMenuKey(event)) return;
        event.preventDefault();
        event.stopPropagation();
        this.toggleCollapsed();
      },
      { capture: true },
    );
    // In full screen the bar slides away until the pointer reaches it.
    ctx.listen(window, "mousemove", (event: MouseEvent) => this.host.toggleAttribute("data-show", event.clientY < SHOW_ZONE), {
      passive: true,
    });
  }

  /** Shows or hides the top-level menus. */
  toggleCollapsed() {
    this.setCollapsed(!this.#collapsed);
  }

  setCollapsed(collapsed: boolean) {
    if (collapsed === this.#collapsed) return;
    this.close();
    this.#collapsed = collapsed;
    this.#menus.hidden = this.#collapsed;
    this.#root.querySelector(".toggle")?.setAttribute("aria-expanded", String(!this.#collapsed));
    // Fresh labels (the language may have changed), and the buttons come in one by one again.
    if (!this.#collapsed) void this.#renderMenus();
  }

  async #renderMenus() {
    const nodes = await this.#ctx.host.invoke("menu");
    this.#buttons = nodes
      .filter((node) => node.kind !== "separator")
      .map(
        (node, index) =>
          (
            <button
              type="button"
              class="menu-button"
              role="menuitem"
              tabIndex={index === 0 ? 0 : -1}
              disabled={!node.enabled}
              aria-haspopup={node.children ? "menu" : undefined}
              aria-expanded={node.children ? "false" : undefined}
              data-index={String(node.index)}
              style={{ "--index": index }}
              onClick={(event: MouseEvent) => void this.#openTop(event.currentTarget as HTMLButtonElement, event.detail === 0)}
              onKeydown={(event: KeyboardEvent) => this.#onButtonKey(event)}
            >
              {node.label}
            </button>
          ) as HTMLButtonElement,
      );
    this.#menus.replaceChildren(...this.#buttons);
  }

  /** Opens the top-level menu of `button` (or closes it, when open); `focusFirst` when opened from the keyboard. */
  async #openTop(button: HTMLButtonElement, focusFirst: boolean) {
    if (this.#openButton === button) {
      this.close();
      return;
    }
    const nodes = await this.#ctx.host.invoke("menu");
    const node = nodes.find((it) => String(it.index) === button.dataset.index);
    if (!node) return;
    if (!node.children) {
      this.close();
      void this.#ctx.host.invoke("clickMenu", [node.index]);
      return;
    }
    const { element, items } = this.#openPanel(node.children, [node.index], 0, belowTrigger(button));
    element.setAttribute("aria-label", node.label);
    this.#openButton = button;
    button.setAttribute("aria-expanded", "true");
    if (focusFirst) items.find((item) => !item.disabled)?.focus();
  }

  close() {
    this.#closeFrom(0);
  }

  /** Closes the panels from `level` in. */
  #closeFrom(level: number) {
    clearTimeout(this.#hoverTimer);
    for (const panel of this.#panels.splice(level)) {
      panel.element.remove();
      panel.owner?.setAttribute("aria-expanded", "false");
    }
    if (this.#panels.length === 0) {
      this.#openButton?.setAttribute("aria-expanded", "false");
      this.#openButton = undefined;
      this.#checkables.clear();
    }
  }

  /** The top-level menu `step` away from the open one (wrapping around), opened from the keyboard. */
  #moveTop(step: number) {
    const from = this.#openButton ?? (this.#root.activeElement as HTMLButtonElement | null);
    const enabled = this.#buttons.filter((button) => !button.disabled);
    const index = from ? enabled.indexOf(from) : -1;
    const next = enabled[(index + step + enabled.length) % enabled.length];
    if (!next) return;
    this.close();
    next.focus();
    void this.#openTop(next, true);
  }

  #onButtonKey(event: KeyboardEvent) {
    const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (step !== undefined) {
      event.preventDefault();
      const enabled = this.#buttons.filter((button) => !button.disabled);
      const index = enabled.indexOf(event.currentTarget as HTMLButtonElement);
      enabled[(index + step + enabled.length) % enabled.length]?.focus();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      void this.#openTop(event.currentTarget as HTMLButtonElement, true);
    }
  }

  #openPanel(nodes: MenuNode[], path: number[], level: number, at: Point, owner?: HTMLButtonElement): Panel {
    this.#closeFrom(level);
    const children = nodes.map((node) => this.#entry(node, [...path, node.index], level));
    const items = children.filter((child): child is HTMLButtonElement => child instanceof HTMLButtonElement);
    const element = (
      <div
        class="panel"
        role="menu"
        aria-label={owner?.dataset.label}
        onKeydown={(event: KeyboardEvent) => this.#onPanelKey(event, panel, level)}
      >
        {children}
      </div>
    );
    const panel: Panel = { element, items };
    if (owner) panel.owner = owner;
    this.#root.append(panel.element);
    placePanel(panel.element, at, owner);
    this.#panels[level] = panel;
    return panel;
  }

  #onPanelKey(event: KeyboardEvent, panel: Panel, level: number) {
    const { owner } = panel;
    const back = () => {
      this.#closeFrom(level);
      owner?.focus();
    };
    const handled = handlePanelKey(event.key, {
      items: panel.items,
      active: this.#root.activeElement,
      back: owner ? back : undefined,
      close: () => {
        const button = this.#openButton;
        this.close();
        button?.focus();
      },
    });
    if (handled) event.preventDefault();
    // Left from a top-level menu, right from an item without a submenu: the next menu in the bar.
    else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      this.#moveTop(event.key === "ArrowLeft" ? -1 : 1);
    }
  }

  #entry(node: MenuNode, path: number[], level: number) {
    if (node.kind === "separator") return <div class="separator" role="separator" />;
    const checkable = node.kind === "checkbox" || node.kind === "radio";
    const item = (
      <button
        class="item"
        tabIndex={-1}
        disabled={!node.enabled}
        data-label={node.label}
        data-kind={node.kind}
        role={ROLES[node.kind]}
        aria-checked={checkable ? node.checked : undefined}
      >
        {mark(node.kind, node.checked)}
        <span class="label">{node.label}</span>
        {node.sublabel ? <span class="chip">{node.sublabel}</span> : <span />}
        {node.children ? strokeIcon(ICONS.submenu) : <kbd>{node.accelerator}</kbd>}
      </button>
    ) as HTMLButtonElement;
    if (node.toolTip) item.title = node.toolTip;
    if (node.children) this.#submenuItem(item, node.children, path, level);
    else this.#commandItem(item, node, path, level);
    return item;
  }

  /** After a pause on it, as in pear-desktop: the pointer may only be passing by. */
  #onHover(item: HTMLButtonElement, action: () => void) {
    item.addEventListener("pointerenter", () => {
      clearTimeout(this.#hoverTimer);
      this.#hoverTimer = setTimeout(action, HOVER_DELAY);
    });
    item.addEventListener("pointerleave", () => clearTimeout(this.#hoverTimer));
  }

  #submenuItem(item: HTMLButtonElement, children: MenuNode[], path: number[], level: number) {
    item.setAttribute("aria-haspopup", "menu");
    item.setAttribute("aria-expanded", "false");
    const openChild = (focus: boolean) => {
      this.#openPanel(children, path, level + 1, besideItem(item), item);
      item.setAttribute("aria-expanded", "true");
      if (focus) this.#panels[level + 1]?.items.find((child) => !child.disabled)?.focus();
    };
    item.addEventListener("click", () => openChild(false));
    this.#onHover(item, () => {
      if (item.getAttribute("aria-expanded") !== "true") openChild(false);
    });
    item.addEventListener("keydown", (event) => {
      if (!opensSubmenu(event)) return;
      event.preventDefault();
      event.stopPropagation();
      openChild(true);
    });
  }

  #commandItem(item: HTMLButtonElement, node: MenuNode, path: number[], level: number) {
    this.#onHover(item, () => this.#closeFrom(level + 1));
    const checkable = node.kind === "checkbox" || node.kind === "radio";
    if (checkable) this.#checkables.set(path.join("/"), item);
    item.addEventListener("click", async () => {
      // As in pear-desktop, a checkbox or radio item stays open and shows its new state; other items close the menu.
      if (!checkable) this.close();
      await this.#ctx.host.invoke("clickMenu", path);
      if (checkable) await this.#refreshChecks();
    });
  }

  /** Shows the current state of the checkable items in the open panels. */
  async #refreshChecks() {
    if (this.#checkables.size === 0) return;
    const nodes = await this.#ctx.host.invoke("menu");
    const visit = (list: MenuNode[], prefix: number[]) => {
      for (const node of list) {
        const path = [...prefix, node.index];
        const item = this.#checkables.get(path.join("/"));
        if (item && (node.kind === "checkbox" || node.kind === "radio")) {
          item.disabled = !node.enabled;
          item.setAttribute("aria-checked", String(node.checked));
          item.firstElementChild?.replaceWith(mark(node.kind, node.checked));
        }
        if (node.children) visit(node.children, path);
      }
    };
    visit(nodes, []);
  }
}

/** The check of a checkbox, the circle of a radio item, or room for them. */
function mark(kind: MenuNode["kind"], checked: boolean): Element {
  if (kind === "checkbox" && checked) return strokeIcon(ICONS.check);
  if (kind === "radio") {
    return (
      <svg class="radio" viewBox="0 0 20 20" aria-hidden="true">
        <path d={ICONS.radio} />
        {checked ? <path d={ICONS.radioDot} /> : null}
      </svg>
    ) as Element;
  }
  return (<span />) as Element;
}

function strokeIcon(d: string) {
  return (
    <svg class="stroke" viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  ) as Element;
}
