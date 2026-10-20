import { config, definePlugin } from "@pear/sdk";
import type { BrowserWindow } from "electron";
import { pageStyles, shadowStyles } from "./styles.ts";

type WindowAction =
  | "settings"
  | "minimize"
  | "toggleMaximize"
  | "close"
  | "reload"
  | "devtools"
  | "zoomIn"
  | "zoomOut"
  | "zoomReset"
  | "fullscreen"
  | "alwaysOnTop"
  | "restart"
  | "quit";

interface WindowState {
  platform: string;
  /** The window was created without the system title bar (needs a restart after enabling). */
  frameless: boolean;
  maximized: boolean;
  fullscreen: boolean;
  alwaysOnTop: boolean;
}

interface MenuEntry {
  label: string;
  action: WindowAction;
  accelerator?: string;
  checked?: (state: WindowState) => boolean;
}

const ZOOM_STEP = 0.5;

const ICONS = {
  menu: "M4 8h4V4H4zm6 12h4v-4h-4zm-6 0h4v-4H4zm0-6h4v-4H4zm6 0h4v-4h-4zm6-10v4h4V4zm-6 4h4V4h-4zm6 6h4v-4h-4zm0 6h4v-4h-4z",
  check: "M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z",
  minimize: "M4 11h16v2H4z",
  maximize: "M5 5h14v14H5zm2 2v10h10V7z",
  restore: "M8 4h12v12h-3v-2h1V6H10v1H8zM4 8h12v12H4zm2 2v8h8v-8z",
  close: "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
};

export default definePlugin({
  id: "in-app-menu",
  name: "In-app menu",
  description: "Replaces the system title bar: the top bar moves the window and holds the app menu.",
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
      run(action: WindowAction) {
        const { window, app } = this;
        const contents = window.webContents;
        switch (action) {
          case "settings":
            return this.openSettings();
          case "minimize":
            return window.minimize();
          case "toggleMaximize":
            return window.isMaximized() ? window.unmaximize() : window.maximize();
          case "close":
            return window.close();
          case "reload":
            return contents.reload();
          case "devtools":
            return contents.toggleDevTools();
          case "zoomIn":
            return contents.setZoomLevel(contents.getZoomLevel() + ZOOM_STEP);
          case "zoomOut":
            return contents.setZoomLevel(contents.getZoomLevel() - ZOOM_STEP);
          case "zoomReset":
            return contents.setZoomLevel(0);
          case "fullscreen":
            return window.setFullScreen(!window.isFullScreen());
          case "alwaysOnTop":
            return window.setAlwaysOnTop(!window.isAlwaysOnTop());
          case "restart":
            app.relaunch();
            return app.quit();
          case "quit":
            return app.quit();
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

    const mod = isMac ? "⌘" : "Ctrl+";
    const entries: (MenuEntry | null)[] = [
      { label: ctx.t("main.tray.settings", "Settings…"), action: "settings", accelerator: `${mod},` },
      null,
      { label: ctx.t("main.menu.view.submenu.reload", "Reload"), action: "reload", accelerator: `${mod}R` },
      {
        label: ctx.t("main.menu.options.submenu.advanced-options.submenu.toggle-dev-tools", "Toggle DevTools"),
        action: "devtools",
        accelerator: isMac ? "⌥⌘I" : "Ctrl+Shift+I",
      },
      null,
      { label: ctx.t("main.menu.view.submenu.zoom-in", "Zoom In"), action: "zoomIn", accelerator: `${mod}+` },
      { label: ctx.t("main.menu.view.submenu.zoom-out", "Zoom Out"), action: "zoomOut", accelerator: `${mod}-` },
      { label: ctx.t("main.menu.view.submenu.reset-zoom", "Actual Size"), action: "zoomReset", accelerator: `${mod}0` },
      {
        label: ctx.t("main.menu.view.submenu.toggle-fullscreen", "Toggle Full Screen"),
        action: "fullscreen",
        accelerator: isMac ? "⌃⌘F" : "F11",
        checked: (s) => s.fullscreen,
      },
      { label: ctx.t("main.menu.options.submenu.always-on-top", "Always on top"), action: "alwaysOnTop", checked: (s) => s.alwaysOnTop },
      null,
      { label: ctx.t("main.menu.navigation.submenu.restart", "Restart App"), action: "restart" },
      {
        label: isMac
          ? ctx.t("plugins.in-app-menu.menu.quit-app", "Quit {{applicationName}}", { applicationName: "\u0059\u006f\u0075\u0054\u0075\u0062\u0065\u0020\u004d\u0075\u0073\u0069\u0063" })
          : ctx.t("main.menu.navigation.submenu.quit", "Exit"),
        action: "quit",
        accelerator: `${mod}Q`,
      },
    ];

    const run = (action: WindowAction) => void ctx.host.invoke("run", action);

    // The menu: a trigger in the top bar's left corner and a popup panel.
    const menuHost = document.createElement("pear-app-menu");
    const menuRoot = shadow(menuHost);
    const trigger = button("trigger", ctx.t("plugins.in-app-menu.menu.application-menu", "Application menu"), ICONS.menu);
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    const panel = document.createElement("div");
    panel.className = "panel";
    panel.setAttribute("role", "menu");
    panel.hidden = true;
    const items: HTMLButtonElement[] = [];
    for (const entry of entries) {
      if (!entry) {
        const separator = document.createElement("div");
        separator.className = "separator";
        separator.setAttribute("role", "separator");
        panel.append(separator);
        continue;
      }
      const item = document.createElement("button");
      item.className = "item";
      item.dataset.action = entry.action;
      item.setAttribute("role", entry.checked ? "menuitemcheckbox" : "menuitem");
      item.tabIndex = -1;
      const check = svg(ICONS.check);
      check.classList.add("check");
      const label = document.createElement("span");
      label.textContent = entry.label;
      const kbd = document.createElement("kbd");
      kbd.textContent = entry.accelerator ?? "";
      item.append(check, label, kbd);
      item.addEventListener("click", () => {
        close();
        run(entry.action);
      });
      items.push(item);
      panel.append(item);
    }
    menuRoot.append(trigger, panel);
    ctx.onCleanup(() => menuHost.remove());

    const updateChecks = () => {
      entries.forEach((entry) => {
        const item = entry && items.find((i) => i.dataset.action === entry.action);
        if (item && entry.checked) item.setAttribute("aria-checked", String(entry.checked(state)));
      });
    };
    const open = (focusFirst: boolean) => {
      const rect = trigger.getBoundingClientRect();
      panel.style.left = `${Math.max(8, rect.left)}px`;
      panel.style.top = `${rect.bottom + 6}px`;
      updateChecks();
      panel.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      if (focusFirst) items[0]?.focus();
    };
    const close = () => {
      if (panel.hidden) return;
      panel.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
    };
    trigger.addEventListener("click", () => (panel.hidden ? open(false) : close()));
    panel.addEventListener("keydown", (event) => {
      const index = items.indexOf(menuRoot.activeElement as HTMLButtonElement);
      const move = (delta: number) => items[(index + delta + items.length) % items.length]?.focus();
      if (event.key === "ArrowDown") move(1);
      else if (event.key === "ArrowUp") move(-1);
      else if (event.key === "Home") items[0]?.focus();
      else if (event.key === "End") items.at(-1)?.focus();
      else if (event.key === "Escape" || event.key === "Tab") {
        close();
        trigger.focus();
      } else return;
      event.preventDefault();
    });
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
        if (panel.hidden) open(true);
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
      updateChecks();
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
