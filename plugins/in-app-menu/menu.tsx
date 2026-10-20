/** @jsxImportSource @pear/sdk */
// The menu: a trigger in the top bar's left corner opening the application menu, its
// submenus cascading from it.

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

interface Panel {
  element: HTMLElement;
  items: HTMLButtonElement[];
  /** The item that opened this submenu. */
  owner?: HTMLButtonElement;
}

export class AppMenu {
  readonly host: HTMLElement;
  readonly #ctx: Ctx;
  readonly #root: ShadowRoot;
  readonly #trigger: HTMLButtonElement;
  /** Open panels, outermost first. */
  #panels: Panel[] = [];

  constructor(ctx: Ctx) {
    this.#ctx = ctx;
    const { host, root } = shadowHost("pear-app-menu", shadowStyles);
    this.host = host;
    this.#root = root;
    const label = ctx.t("plugins.in-app-menu.menu.application-menu", "Application menu");
    this.#trigger = (
      <button
        type="button"
        class="trigger"
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded="false"
        onClick={() => this.toggle(false)}
      >
        <Icon path={ICONS.menu} />
      </button>
    ) as HTMLButtonElement;
    root.append(this.#trigger);
    ctx.onCleanup(() => host.remove());
    this.#listen();
  }

  #listen() {
    const ctx = this.#ctx;
    // Keep YTM's own shortcuts (space, j/k…) out of the menu.
    isolateKeys(this.host, ctx.signal);
    ctx.listen(document, "pointerdown", (event: PointerEvent) => {
      if (!event.composedPath().includes(this.host)) this.close();
    });
    ctx.listen(window, "blur", () => this.close());
    const onKeydown = (event: KeyboardEvent) => {
      if (!isMenuKey(event)) return;
      event.preventDefault();
      event.stopPropagation();
      this.toggle(true);
    };
    ctx.listen(window, "keydown", onKeydown, { capture: true });
  }

  toggle(focusFirst: boolean) {
    if (this.#panels.length === 0) void this.open(focusFirst);
    else this.close();
  }

  async open(focusFirst: boolean) {
    const nodes = await this.#ctx.host.invoke("menu");
    const { items } = this.#openPanel(nodes, [], 0, belowTrigger(this.#trigger));
    this.#trigger.setAttribute("aria-expanded", "true");
    if (focusFirst) items.find((item) => !item.disabled)?.focus();
  }

  close() {
    this.#closeFrom(0);
  }

  /** Closes the panels from `level` in. */
  #closeFrom(level: number) {
    for (const panel of this.#panels.splice(level)) {
      panel.element.remove();
      panel.owner?.setAttribute("aria-expanded", "false");
    }
    if (this.#panels.length === 0) this.#trigger.setAttribute("aria-expanded", "false");
  }

  #openPanel(nodes: MenuNode[], path: number[], level: number, at: Point, owner?: HTMLButtonElement): Panel {
    this.#closeFrom(level);
    const children = nodes.map((node) => this.#entry(node, [...path, node.index], level));
    const items = children.filter((child): child is HTMLButtonElement => child instanceof HTMLButtonElement);
    const element = (
      <div class="panel" role="menu" aria-label={owner?.dataset.label} onKeydown={(event) => this.#onPanelKey(event, panel, level)}>
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
        this.close();
        this.#trigger.focus();
      },
    });
    if (handled) event.preventDefault();
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
        role={ROLES[node.kind]}
        aria-checked={checkable ? node.checked : undefined}
      >
        <Icon path={ICONS.check} />
        <span class="label">
          {node.label}
          {node.sublabel ? <small>{node.sublabel}</small> : null}
        </span>
        {node.children ? <Icon path={ICONS.submenu} /> : <kbd>{node.accelerator}</kbd>}
      </button>
    ) as HTMLButtonElement;
    if (node.toolTip) item.title = node.toolTip;
    if (node.children) this.#submenuItem(item, node.children, path, level);
    else this.#commandItem(item, path, level);
    return item;
  }

  #submenuItem(item: HTMLButtonElement, children: MenuNode[], path: number[], level: number) {
    item.setAttribute("aria-haspopup", "menu");
    item.setAttribute("aria-expanded", "false");
    const openChild = (focus: boolean) => {
      this.#openPanel(children, path, level + 1, besideItem(item), item);
      item.setAttribute("aria-expanded", "true");
      if (focus) this.#panels[level + 1]?.items[0]?.focus();
    };
    item.addEventListener("click", () => openChild(false));
    item.addEventListener("pointerenter", () => {
      if (item.getAttribute("aria-expanded") !== "true") openChild(false);
    });
    item.addEventListener("keydown", (event) => {
      if (!opensSubmenu(event)) return;
      event.preventDefault();
      event.stopPropagation();
      openChild(true);
    });
  }

  #commandItem(item: HTMLButtonElement, path: number[], level: number) {
    item.addEventListener("pointerenter", () => this.#closeFrom(level + 1));
    item.addEventListener("click", () => {
      this.close();
      void this.#ctx.host.invoke("clickMenu", path);
    });
  }
}
