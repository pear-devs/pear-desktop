import { definePlugin } from "@pear/sdk";
import { type BrowserWindow, type BrowserWindowConstructorOptions, Menu, type WebContents } from "electron";
import { clickableItem, serialize } from "./app-menu.ts";
import { inAppMenuConfig } from "./config.ts";
import { startPage } from "./page.ts";
import type { MenuNode, WindowAction, WindowState } from "./types.ts";

// The native caption buttons Windows draws over the top bar match YTM's nav bar.
const NAV_BAR_HEIGHT = 64;

/** The window without the system title bar, by platform (Linux and the rest: no frame). */
const FRAMELESS_OPTIONS: Partial<Record<string, BrowserWindowConstructorOptions>> = {
  darwin: { titleBarStyle: "hiddenInset" },
  win32: { titleBarStyle: "hidden", titleBarOverlay: { color: "#00000000", symbolColor: "#ffffff", height: NAV_BAR_HEIGHT } },
};

const STATE_EVENTS = ["maximize", "unmaximize", "enter-full-screen", "leave-full-screen", "always-on-top-changed"];

export default definePlugin({
  id: "in-app-menu",
  name: "In-app menu",
  description: "Replaces the system title bar: the top bar moves the window and holds the app menu.",
  // As in pear-desktop.
  enabledByDefault: ["win32"],
  config: inAppMenuConfig,
  host: {
    windowOptions() {
      frameless = true;
      return FRAMELESS_OPTIONS[process.platform] ?? { frame: false };
    },
    start(ctx) {
      const sendState = () => ctx.emit("state", windowState(ctx.window));
      for (const event of STATE_EVENTS) ctx.listen(ctx.window, event, sendState);
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
        const item = clickableItem(Menu.getApplicationMenu(), path);
        if (!item) return;
        // Electron flips checkboxes itself; roles act on the window they're given.
        (item.click as (event?: unknown, window?: BrowserWindow, contents?: WebContents) => void)(
          undefined,
          this.window,
          this.window.webContents,
        );
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
  page: startPage,
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
