import { config, definePlugin } from "@pear/sdk";
import { type BrowserWindow, Menu, type MenuItem, type WebContents } from "electron";
import { pageStyles, shadowStyles } from "./styles.ts";

type WindowAction = "minimize" | "toggleMaximize" | "close";

interface WindowState {
  platform: string;
  /** The window was created without the system title bar (needs a restart after enabling). */
  frameless: boolean;
  maximized: boolean;
  fullscreen: boolean;
  alwaysOnTop: boolean;
}

/** An item of the application menu, as the page draws it. */
interface MenuNode {
  /** Index among its menu's items (invisible ones included), for clicking it. */
  index: number;
  kind: "normal" | "checkbox" | "radio" | "submenu" | "separator";
  label: string;
  sublabel: string;
  toolTip: string;
  accelerator: string;
  enabled: boolean;
  checked: boolean;
  children?: MenuNode[];
}

const ICONS = {
  menu: "M4 8h4V4H4zm6 12h4v-4h-4zm-6 0h4v-4H4zm0-6h4v-4H4zm6 0h4v-4h-4zm6-10v4h4V4zm-6 4h4V4h-4zm6 6h4v-4h-4zm0 6h4v-4h-4z",
  check: "M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z",
  submenu: "M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z",
  minimize: "M4 11h16v2H4z",
  maximize: "M5 5h14v14H5zm2 2v10h10V7z",
  restore: "M8 4h12v12h-3v-2h1V6H10v1H8zM4 8h12v12H4zm2 2v8h8v-8z",
  close: "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
};

export default definePlugin({
  id: "in-app-menu",
  name: "In-app menu",
  description: "Replaces the system title bar: the top bar moves the window and holds the app menu.",
  // As in pear-desktop.
  enabledByDefault: ["win32"],
  config: {
    windowControls: config.bool(true, {
      label: "Show window buttons",
      description: "Minimize, maximize and close on Linux. Turn off if your window manager provides its own.",
    }),
  },
  host: {
    windowOptions() {
      frameless = true;
      return process.platform === "darwin"
        ? { titleBarStyle: "hiddenInset" }
        : process.platform === "win32"
          ? { titleBarStyle: "hidden", titleBarOverlay: { color: "#00000000", symbolColor: "#ffffff", height: 64 } }
          : { frame: false };
    },
    start(ctx) {
      const { window } = ctx;
      const sendState = () => ctx.emit("state", windowState(window));
      const events = ["maximize", "unmaximize", "enter-full-screen", "leave-full-screen", "always-on-top-changed"] as const;
      for (const event of events) window.on(event as "maximize", sendState);
      ctx.onCleanup(() => {
        for (const event of events) window.off(event as "maximize", sendState);
      });
    },
    commands: {
      state() {
        return windowState(this.window);
      },
      /** The application menu (pear-desktop drew the whole of it in the page). */
      menu(): MenuNode[] {
        const menu = Menu.getApplicationMenu();
        return menu ? serialize(menu, process.platform === "darwin") : [];
      },
      clickMenu(path: number[]) {
        let items = Menu.getApplicationMenu()?.items;
        let item: MenuItem | undefined;
        for (const index of path) {
          item = items?.[index];
          items = item?.submenu?.items;
        }
        if (!item || !item.enabled || item.submenu) return;
        // Electron flips checkboxes itself; roles act on the window they're given.
        (item.click as (event?: unknown, window?: BrowserWindow, contents?: WebContents) => void)(undefined, this.window, this.window.webContents);
      },
      run(action: WindowAction) {
        const { window } = this;
        switch (action) {
          case "minimize":
            return window.minimize();
          case "toggleMaximize":
            return window.isMaximized() ? window.unmaximize() : window.maximize();
          case "close":
            return window.close();
        }
      },
    },
  },
  page: async (ctx) => {
    ctx.addStyle(pageStyles);
    let state: WindowState = await ctx.host.invoke("state");
    const isMac = state.platform === "darwin";
    // Until a restart after enabling, the system title bar is still there: just the menu then.
    const root = document.documentElement;
    root.classList.toggle("pear-frameless", state.frameless);
    root.classList.toggle("pear-traffic-lights", state.frameless && isMac);
    root.classList.toggle("pear-caption-buttons", state.frameless && state.platform === "win32");
    ctx.onCleanup(() => root.classList.remove("pear-frameless", "pear-traffic-lights", "pear-caption-buttons"));

    const run = (action: WindowAction) => void ctx.host.invoke("run", action);

    // The menu: a trigger in the top bar's left corner opening the application menu, its
    // submenus cascading from it.
    const menuHost = document.createElement("pear-app-menu");
    const menuRoot = shadow(menuHost);
    const trigger = button("trigger", ctx.t("plugins.in-app-menu.menu.application-menu", "Application menu"), ICONS.menu);
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    menuRoot.append(trigger);
    ctx.onCleanup(() => menuHost.remove());

    /** Open panels, outermost first. */
    let panels: { element: HTMLDivElement; items: HTMLButtonElement[]; owner?: HTMLButtonElement }[] = [];
    const closeFrom = (level: number) => {
      for (const panel of panels.splice(level)) {
        panel.element.remove();
        panel.owner?.setAttribute("aria-expanded", "false");
      }
      if (panels.length === 0) trigger.setAttribute("aria-expanded", "false");
    };
    const close = () => closeFrom(0);

    const openPanel = (nodes: MenuNode[], path: number[], level: number, at: { left: number; top: number }, owner?: HTMLButtonElement) => {
      closeFrom(level);
      const panel = document.createElement("div");
      panel.className = "panel";
      panel.setAttribute("role", "menu");
      if (owner) panel.setAttribute("aria-label", owner.dataset.label ?? "");
      const items: HTMLButtonElement[] = [];
      for (const node of nodes) {
        if (node.kind === "separator") {
          const separator = document.createElement("div");
          separator.className = "separator";
          separator.setAttribute("role", "separator");
          panel.append(separator);
          continue;
        }
        const item = document.createElement("button");
        item.className = "item";
        item.tabIndex = -1;
        item.disabled = !node.enabled;
        item.dataset.label = node.label;
        item.setAttribute("role", node.kind === "checkbox" ? "menuitemcheckbox" : node.kind === "radio" ? "menuitemradio" : "menuitem");
        if (node.kind === "checkbox" || node.kind === "radio") item.setAttribute("aria-checked", String(node.checked));
        if (node.toolTip) item.title = node.toolTip;
        const check = svg(ICONS.check);
        check.classList.add("check");
        const label = document.createElement("span");
        label.className = "label";
        label.textContent = node.label;
        if (node.sublabel) {
          const sub = document.createElement("small");
          sub.textContent = node.sublabel;
          label.append(sub);
        }
        const end = node.children ? svg(ICONS.submenu) : document.createElement("kbd");
        if (!node.children) end.textContent = node.accelerator;
        item.append(check, label, end);
        const itemPath = [...path, node.index];
        if (node.children) {
          const children = node.children;
          item.setAttribute("aria-haspopup", "menu");
          item.setAttribute("aria-expanded", "false");
          const openChild = (focus: boolean) => {
            const rect = item.getBoundingClientRect();
            openPanel(children, itemPath, level + 1, { left: rect.right + 4, top: rect.top - 7 }, item);
            item.setAttribute("aria-expanded", "true");
            if (focus) panels[level + 1]?.items[0]?.focus();
          };
          item.addEventListener("click", () => openChild(false));
          item.addEventListener("pointerenter", () => {
            if (item.getAttribute("aria-expanded") !== "true") openChild(false);
          });
          item.addEventListener("keydown", (event) => {
            if (event.key !== "ArrowRight" && event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            event.stopPropagation();
            openChild(true);
          });
        } else {
          item.addEventListener("pointerenter", () => closeFrom(level + 1));
          item.addEventListener("click", () => {
            close();
            void ctx.host.invoke("clickMenu", itemPath);
          });
        }
        items.push(item);
        panel.append(item);
      }
      panel.addEventListener("keydown", (event) => {
        const index = items.indexOf(menuRoot.activeElement as HTMLButtonElement);
        const enabled = items.filter((item) => !item.disabled);
        const move = (delta: number) => {
          const from = enabled.indexOf(items[index]!);
          enabled[(from + delta + enabled.length) % enabled.length]?.focus();
        };
        if (event.key === "ArrowDown") move(1);
        else if (event.key === "ArrowUp") move(-1);
        else if (event.key === "Home") enabled[0]?.focus();
        else if (event.key === "End") enabled.at(-1)?.focus();
        else if (event.key === "ArrowLeft" && level > 0) {
          closeFrom(level);
          owner?.focus();
        } else if (event.key === "Escape" || event.key === "Tab") {
          close();
          trigger.focus();
        } else return;
        event.preventDefault();
      });
      menuRoot.append(panel);
      // Keep panels on screen.
      const width = panel.offsetWidth;
      const height = panel.offsetHeight;
      const left = at.left + width > innerWidth - 8 && level > 0 && owner ? owner.getBoundingClientRect().left - width - 4 : at.left;
      panel.style.left = `${Math.max(8, Math.min(left, innerWidth - width - 8))}px`;
      panel.style.top = `${Math.max(8, Math.min(at.top, innerHeight - height - 8))}px`;
      panels[level] = { element: panel, items, ...(owner ? { owner } : {}) };
      return items;
    };

    const open = async (focusFirst: boolean) => {
      const nodes = await ctx.host.invoke("menu");
      const rect = trigger.getBoundingClientRect();
      const items = openPanel(nodes, [], 0, { left: rect.left, top: rect.bottom + 6 });
      trigger.setAttribute("aria-expanded", "true");
      if (focusFirst) items.find((item) => !item.disabled)?.focus();
    };
    trigger.addEventListener("click", () => (panels.length === 0 ? void open(false) : close()));
    // Keep YTM's own shortcuts (space, j/k…) out of the menu.
    for (const type of ["keydown", "keyup", "keypress"]) {
      menuHost.addEventListener(type, (event) => event.stopPropagation());
    }
    ctx.listen(document, "pointerdown", (event: PointerEvent) => {
      if (!event.composedPath().includes(menuHost)) close();
    });
    ctx.listen(window, "blur", close);
    // F10 opens the menu, as in most desktop apps.
    ctx.listen(
      window,
      "keydown",
      (event: KeyboardEvent) => {
        if (event.key !== "F10" || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
        event.preventDefault();
        event.stopPropagation();
        if (panels.length === 0) void open(true);
        else close();
      },
      { capture: true },
    );

    // Window buttons (Linux; Windows draws native ones over the bar, macOS has traffic lights).
    const controlsHost = document.createElement("pear-window-controls");
    const showControls = state.frameless && state.platform === "linux" && ctx.config.windowControls;
    let maximizeButton: HTMLButtonElement | undefined;
    if (showControls) {
      const controlsRoot = shadow(controlsHost);
      const controls = document.createElement("div");
      controls.className = "controls";
      maximizeButton = button("maximize", ctx.t("plugins.in-app-menu.window.maximize", "Maximize"), ICONS.maximize);
      const minimize = button("minimize", ctx.t("plugins.in-app-menu.window.minimize", "Minimize"), ICONS.minimize);
      const closeButton = button("close", ctx.t("plugins.in-app-menu.window.close", "Close"), ICONS.close);
      minimize.addEventListener("click", () => run("minimize"));
      maximizeButton.addEventListener("click", () => run("toggleMaximize"));
      closeButton.addEventListener("click", () => run("close"));
      controls.append(minimize, maximizeButton, closeButton);
      controlsRoot.append(controls);
    }
    ctx.onCleanup(() => controlsHost.remove());

    const applyState = () => {
      if (!maximizeButton) return;
      const label = state.maximized
        ? ctx.t("plugins.in-app-menu.window.restore", "Restore")
        : ctx.t("plugins.in-app-menu.window.maximize", "Maximize");
      maximizeButton.title = label;
      maximizeButton.setAttribute("aria-label", label);
      maximizeButton.replaceChildren(svg(state.maximized ? ICONS.restore : ICONS.maximize));
    };
    applyState();
    ctx.host.on("state", (next) => {
      state = next as WindowState;
      applyState();
    });

    const mount = () => {
      const left = ctx.$("nav_bar.left");
      const right = ctx.$("nav_bar.right");
      if (left && left.firstElementChild !== menuHost) left.prepend(menuHost);
      if (showControls && right && right.lastElementChild !== controlsHost) right.append(controlsHost);
    };
    await ctx.waitFor("nav_bar.right");
    mount();
    // YTM re-renders the nav bar on some navigations, and appends to it after us.
    const observer = new MutationObserver(mount);
    observer.observe(ctx.$("nav_bar")!, { childList: true, subtree: true });
    ctx.onCleanup(() => observer.disconnect());
  },
});

// Set when the main window is created with this plugin's options.
let frameless = false;

function windowState(window: BrowserWindow): WindowState {
  return {
    platform: process.platform,
    frameless,
    maximized: window.isMaximized(),
    fullscreen: window.isFullScreen(),
    alwaysOnTop: window.isAlwaysOnTop(),
  };
}

function serialize(menu: Menu, isMac: boolean): MenuNode[] {
  return menu.items.flatMap((item, index): MenuNode[] => {
    if (!item.visible) return [];
    if (item.type === "separator") {
      return [{ index, kind: "separator", label: "", sublabel: "", toolTip: "", accelerator: "", enabled: true, checked: false }];
    }
    const children = item.submenu ? serialize(item.submenu, isMac) : undefined;
    return [
      {
        index,
        kind: children ? "submenu" : item.type === "checkbox" ? "checkbox" : item.type === "radio" ? "radio" : "normal",
        label: item.label.replace(/&(?=\S)/g, ""),
        sublabel: item.sublabel ?? "",
        toolTip: item.toolTip ?? "",
        accelerator: item.accelerator ? displayAccelerator(String(item.accelerator), isMac) : "",
        enabled: item.enabled,
        checked: item.checked,
        ...(children ? { children } : {}),
      },
    ];
  });
}

/** "CmdOrCtrl+Shift+I" as shown in menus. */
function displayAccelerator(accelerator: string, isMac: boolean) {
  const parts = accelerator.split(/\+(?!$)/).map((part) => {
    const lower = part.toLowerCase();
    if (lower === "cmdorctrl" || lower === "commandorcontrol") return isMac ? "⌘" : "Ctrl";
    if (lower === "plus") return "+";
    if (isMac) return { alt: "⌥", option: "⌥", shift: "⇧", ctrl: "⌃", control: "⌃", cmd: "⌘", command: "⌘" }[lower] ?? part;
    return part;
  });
  return parts.join(isMac ? "" : "+");
}

function shadow(host: HTMLElement) {
  const root = host.attachShadow({ mode: "open" });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(shadowStyles);
  root.adoptedStyleSheets = [sheet];
  return root;
}

function button(className: string, label: string, icon: string) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.title = label;
  element.setAttribute("aria-label", label);
  element.append(svg(icon));
  return element;
}

function svg(d: string) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  element.setAttribute("viewBox", "0 0 24 24");
  element.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", d);
  element.append(path);
  return element;
}
