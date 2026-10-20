// The native application menu, like pear-desktop's (src/menu.ts) without its
// Plugins and Options submenus: the settings dialog replaced those. The
// in-app-menu plugin draws this same menu in the page.

import { app, type BrowserWindow, clipboard, Menu, type MenuItemConstructorOptions, shell } from "electron";
import type { PluginMenuItem } from "@pear/sdk";
import type { Translate } from "@pear/sdk/i18n";
import { alive } from "./windows.ts";

export interface MenuEnvironment {
  platform: NodeJS.Platform;
  t: Translate;
  /** The YTM window. */
  window(): BrowserWindow | undefined;
  openSettings(): void;
  /** Plugins' items (`ctx.addMenuItem`), below Settings. */
  pluginItems(): readonly PluginMenuItem[];
  alwaysOnTop(): boolean;
  setAlwaysOnTop(value: boolean): void;
  /** config.json */
  settingsPath: string;
  restart(): void;
}

export const ALWAYS_ON_TOP_ID = "always-on-top";

type Contents = () => Electron.WebContents | undefined;

export function menuTemplate(env: MenuEnvironment): MenuItemConstructorOptions[] {
  const isMac = env.platform === "darwin";
  const contents = () => alive(env.window())?.webContents;
  const settings = settingsItem(env);
  const template = [optionsMenu(env, contents, isMac ? undefined : settings), viewMenu(env), navigationMenu(env, contents), aboutMenu(env)];
  return isMac ? [macAppMenu(settings), ...template] : template;
}

function settingsItem(env: MenuEnvironment): MenuItemConstructorOptions {
  return {
    id: "settings",
    label: env.t("main.menu.options.submenu.settings", "Settings…"),
    accelerator: "CmdOrCtrl+,",
    // The page handles the shortcut itself (it toggles the dialog).
    registerAccelerator: false,
    click: () => env.openSettings(),
  };
}

/** `settings` leads the menu, except on macOS where it is in the app menu; plugins' items follow. */
function optionsMenu(env: MenuEnvironment, contents: Contents, settings: MenuItemConstructorOptions | undefined): MenuItemConstructorOptions {
  const { t } = env;
  const leading = [...(settings ? [settings] : []), ...env.pluginItems().map(pluginItem)];
  return {
    label: t("main.menu.options.label", "Options"),
    submenu: [
      ...(leading.length > 0 ? [...leading, { type: "separator" } as const] : []),
      {
        id: ALWAYS_ON_TOP_ID,
        label: t("main.menu.options.submenu.always-on-top", "Always on top"),
        type: "checkbox",
        checked: env.alwaysOnTop(),
        click: (item) => env.setAlwaysOnTop(item.checked),
      },
      { type: "separator" },
      {
        label: t("main.menu.options.submenu.advanced-options.submenu.toggle-dev-tools", "Toggle DevTools"),
        accelerator: env.platform === "darwin" ? "Alt+Cmd+I" : "Ctrl+Shift+I",
        click: () => contents()?.toggleDevTools(),
      },
      {
        label: t("main.menu.options.submenu.advanced-options.submenu.edit-config-json", "Edit config.json"),
        click: () => void shell.openPath(env.settingsPath),
      },
    ],
  };
}

function pluginItem({ label, accelerator, click }: PluginMenuItem): MenuItemConstructorOptions {
  return { label, ...(accelerator ? { accelerator } : {}), click: () => click() };
}

function viewMenu({ t }: MenuEnvironment): MenuItemConstructorOptions {
  return {
    label: t("main.menu.view.label", "View"),
    submenu: [
      { label: t("main.menu.view.submenu.reload", "Reload"), role: "reload" },
      { label: t("main.menu.view.submenu.force-reload", "Force Reload"), role: "forceReload" },
      { type: "separator" },
      // An item takes one accelerator; hidden twins make zooming work with or without
      // Shift held (Ctrl+= and Ctrl+Plus, Ctrl+- and Ctrl+Shift+-), as in pear-desktop.
      { label: t("main.menu.view.submenu.zoom-in", "Zoom In"), role: "zoomIn", accelerator: "CmdOrCtrl+=", visible: false },
      { label: t("main.menu.view.submenu.zoom-in", "Zoom In"), role: "zoomIn", accelerator: "CmdOrCtrl+Plus" },
      { label: t("main.menu.view.submenu.zoom-out", "Zoom Out"), role: "zoomOut", accelerator: "CmdOrCtrl+-" },
      { label: t("main.menu.view.submenu.zoom-out", "Zoom Out"), role: "zoomOut", accelerator: "CmdOrCtrl+Shift+-", visible: false },
      { label: t("main.menu.view.submenu.reset-zoom", "Actual Size"), role: "resetZoom" },
      { type: "separator" },
      { label: t("main.menu.view.submenu.toggle-fullscreen", "Toggle Full Screen"), role: "togglefullscreen" },
    ],
  };
}

function navigationMenu(env: MenuEnvironment, contents: Contents): MenuItemConstructorOptions {
  const { t } = env;
  return {
    label: t("main.menu.navigation.label", "Navigation"),
    submenu: [
      {
        label: t("main.menu.navigation.submenu.go-back", "Go back"),
        click: () => {
          const history = contents()?.navigationHistory;
          if (history?.canGoBack()) history.goBack();
        },
      },
      {
        label: t("main.menu.navigation.submenu.go-forward", "Go forward"),
        click: () => {
          const history = contents()?.navigationHistory;
          if (history?.canGoForward()) history.goForward();
        },
      },
      {
        label: t("main.menu.navigation.submenu.copy-current-url", "Copy current URL"),
        click: () => {
          const url = contents()?.getURL();
          if (url) clipboard.writeText(url);
        },
      },
      { label: t("main.menu.navigation.submenu.restart", "Restart App"), click: () => env.restart() },
      { label: t("main.menu.navigation.submenu.quit", "Exit"), role: "quit" },
    ],
  };
}

function aboutMenu({ t }: MenuEnvironment): MenuItemConstructorOptions {
  return { label: t("main.menu.about", "About"), submenu: [{ role: "about" }] };
}

function macAppMenu(settings: MenuItemConstructorOptions): MenuItemConstructorOptions {
  return {
    label: app.name,
    submenu: [
      { role: "about" },
      { type: "separator" },
      settings,
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      { type: "separator" },
      { role: "selectAll" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { type: "separator" },
      { role: "minimize" },
      { role: "close" },
      { role: "quit" },
    ],
  };
}

export function setApplicationMenu(env: MenuEnvironment) {
  const menu = Menu.buildFromTemplate(menuTemplate(env));
  Menu.setApplicationMenu(menu);
  return menu;
}

/** Keeps the menu's checkbox in step when the option changes elsewhere (settings, API). */
export function syncMenu(alwaysOnTop: boolean) {
  const item = Menu.getApplicationMenu()?.getMenuItemById(ALWAYS_ON_TOP_ID);
  if (item) item.checked = alwaysOnTop;
}

/** window.hideMenu: the menu bar hides and Alt shows it (Linux and Windows; macOS has a global menu bar). */
export function applyHideMenu(window: BrowserWindow, hide: boolean) {
  window.setAutoHideMenuBar(hide);
  window.setMenuBarVisibility(!hide);
}
