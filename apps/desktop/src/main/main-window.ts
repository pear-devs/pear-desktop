// The YTM window: its options and saved bounds, the user agent per destination,
// the title, and the page it starts on. Also the channel to its page runtime.

import { app, type BrowserWindowConstructorOptions, BrowserWindow, screen, shell } from "electron";
import { STARTING_PAGES, type StartingPage } from "@pear/sdk/core-config";
import { CHANNEL, type HostEvent } from "@pear/sdk/protocol";
import { chromeUserAgent, isGoogleAuth, isYtmUrl, YTM_ORIGIN } from "../shared/user-agent.ts";
import { APP_NAME } from "./app-identity.ts";
import type { Settings, WindowState } from "./config.ts";
import { navigationAction, windowOpenAction } from "./links.ts";
import type { PluginHost } from "./plugins.ts";
import { openSettingsWindow, settingsWindowContents } from "./settings-window.ts";
import { alive, appIcon, focusWindow, secureWebPreferences } from "./windows.ts";

const MIN_WIDTH = 360;
const MIN_HEIGHT = 300;
/** YTM's own background, so the window doesn't flash white while loading. */
const BACKGROUND_COLOR = "#030303";
const DEFAULT_SIZE = { width: 1280, height: 800 };

/** The standalone settings window only follows state, not page-runtime traffic. */
const SETTINGS_EVENTS = new Set<HostEvent["type"]>(["plugin-state", "plugin-error", "plugin-status", "core-state"]);

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class MainWindow {
  #settings: Settings;
  #plugins: PluginHost;
  #window: BrowserWindow | undefined;
  /** Whether the page runtime of the current page is up (it can show the in-page settings). */
  #runtimeUp = false;
  #electronUserAgent = "";
  #ytmUserAgent = "";

  constructor(settings: Settings, plugins: PluginHost) {
    this.#settings = settings;
    this.#plugins = plugins;
  }

  /** The window, unless there is none (yet, or any more). */
  get window() {
    return alive(this.#window);
  }

  /** Once the app is ready: YTM gets a Chrome UA, Google sign-in Electron's (returned). */
  useYtmUserAgent() {
    this.#electronUserAgent = app.userAgentFallback;
    this.#ytmUserAgent = chromeUserAgent(this.#electronUserAgent);
    app.userAgentFallback = this.#ytmUserAgent;
    return this.#electronUserAgent;
  }

  /** Sends an event to the page runtime (and to the standalone settings window, if it follows that). */
  readonly send = (event: HostEvent) => {
    this.window?.webContents.send(CHANNEL.event, event);
    if (SETTINGS_EVENTS.has(event.type)) settingsWindowContents()?.send(CHANNEL.event, event);
  };

  /** The in-page overlay when YTM is up, otherwise the standalone window. */
  readonly openSettings = () => {
    const window = this.window;
    if (!window || !this.#runtimeUp) {
      openSettingsWindow();
      return;
    }
    focusWindow(window);
    this.send({ type: "ui", action: "open-settings" });
  };

  focus() {
    const window = this.window;
    if (window) focusWindow(window);
  }

  /** A page runtime said hello; it can show the in-page settings if it is this window's. */
  runtimeBootstrapped(sender: Electron.WebContents) {
    if (this.#window && sender === this.#window.webContents) this.#runtimeUp = true;
  }

  create() {
    const settings = this.#settings;
    const window = new BrowserWindow(this.#options());
    this.#window = window;
    if (settings.window?.maximized) window.maximize();
    window.once("ready-to-show", () => {
      if (this.#startsHidden()) return;
      window.show();
      console.info(`[pear] startup: window shown after ${Math.round(performance.now())}ms`);
    });

    // The custom title stays put; without one the window follows the page's.
    window.on("page-title-updated", (event) => {
      if (!settings.core("appearance").customWindowTitle) return;
      event.preventDefault();
      window.setTitle(windowTitle(settings, window));
    });

    // YTM asks "leave page?" while playing, which would silently cancel quitting.
    window.webContents.on("will-prevent-unload", (event) => event.preventDefault());
    window.webContents.on("render-process-gone", () => {
      this.#runtimeUp = false;
    });
    this.#followNavigation(window);
    routeLinks(window);
    this.#saveBounds(window);
    void window.loadURL(startUrl(settings.core("general"), settings.lastUrl));
    return window;
  }

  #options(): BrowserWindowConstructorOptions {
    const settings = this.#settings;
    const pluginOptions = this.#plugins.windowOptions();
    // Plugins may override these (frame, transparency, colors)…
    const defaults: BrowserWindowConstructorOptions = {
      minWidth: MIN_WIDTH,
      minHeight: MIN_HEIGHT,
      backgroundColor: BACKGROUND_COLOR,
      alwaysOnTop: settings.core("window").alwaysOnTop,
      title: settings.core("appearance").customWindowTitle || APP_NAME,
      icon: appIcon(),
      autoHideMenuBar: settings.core("window").hideMenu,
    };
    // …but not geometry, visibility or the security-relevant preferences.
    const enforced: BrowserWindowConstructorOptions = {
      ...windowBounds(settings.window),
      show: false,
      webPreferences: { ...pluginOptions.webPreferences, ...secureWebPreferences(), backgroundThrottling: false },
    };
    return { ...defaults, ...pluginOptions, ...enforced };
  }

  /** Hidden starts only make sense with a tray icon to bring the window back. */
  #startsHidden() {
    return !this.#settings.core("window").appVisible && Boolean(this.#settings.plugin("tray")?.enabled);
  }

  #followNavigation(window: BrowserWindow) {
    // Keep navigator.userAgent consistent with the UA header per destination.
    window.webContents.on("did-start-navigation", ({ url, isMainFrame, isSameDocument }) => {
      if (!isMainFrame) return;
      if (!isSameDocument) this.#runtimeUp = false;
      const userAgent = isGoogleAuth(url) ? this.#electronUserAgent : this.#ytmUserAgent;
      if (window.webContents.getUserAgent() !== userAgent) window.webContents.setUserAgent(userAgent);
    });
    window.webContents.on("did-navigate-in-page", (_, url, isMainFrame) => {
      if (isMainFrame && isYtmUrl(url)) this.#settings.lastUrl = url;
    });
  }

  #saveBounds(window: BrowserWindow) {
    const settings = this.#settings;
    const save = () => {
      if (!alive(window) || window.isMinimized()) return;
      const maximized = window.isMaximized();
      // Maximized, keep the size to restore to.
      const bounds = maximized ? (settings.window ?? window.getNormalBounds()) : window.getBounds();
      settings.window = { ...bounds, maximized };
    };
    window.on("resize", save);
    window.on("move", save);
    window.on("maximize", save);
    window.on("unmaximize", save);
  }
}

/** YTM links stay in this window, other web pages open in the browser, the rest nowhere. */
function routeLinks(window: BrowserWindow) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    const action = windowOpenAction(url);
    if (action === "load") void window.loadURL(url);
    if (action === "external") void shell.openExternal(url);
    return { action: "deny" };
  });
  // Only page-initiated navigations: redirects (sign-in's way back) don't come here.
  window.webContents.on("will-navigate", (event) => {
    const action = navigationAction(event.url);
    if (action === "allow") return;
    event.preventDefault();
    if (action === "external") void shell.openExternal(event.url);
  });
}

/** The custom window title, or the page's. */
export function windowTitle(settings: Settings, window: BrowserWindow) {
  return settings.core("appearance").customWindowTitle || window.webContents.getTitle() || APP_NAME;
}

/** The last YTM page (never straight into a track) if enabled, otherwise the starting page. */
function startUrl(general: { resumeOnStart: boolean; startingPage: StartingPage }, lastUrl: string | undefined) {
  const last = general.resumeOnStart && lastUrl ? URL.parse(lastUrl) : null;
  if (last && last.origin === YTM_ORIGIN && last.pathname !== "/watch") return last.toString();
  return new URL(STARTING_PAGES[general.startingPage] ?? "/", `${YTM_ORIGIN}/`).toString();
}

function windowBounds(saved: WindowState | undefined): Partial<Rect> {
  if (!saved) return { ...DEFAULT_SIZE };
  const { x, y, width, height } = saved;
  const size = { width, height };
  if (x === undefined || y === undefined) return size;
  const bounds = { x, y, width, height };
  // Ignore positions on displays that are no longer connected.
  const visible = screen.getAllDisplays().some((display) => intersects(bounds, display.workArea));
  return visible ? bounds : size;
}

function intersects(a: Rect, b: Rect) {
  const overlapsX = a.x < b.x + b.width && a.x + a.width > b.x;
  const overlapsY = a.y < b.y + b.height && a.y + a.height > b.y;
  return overlapsX && overlapsY;
}
