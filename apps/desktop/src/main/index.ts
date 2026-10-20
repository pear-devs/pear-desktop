import { join } from "node:path";
import { app, BrowserWindow, nativeImage, screen, session } from "electron";
import { interpolate, type Translate } from "@pear/sdk/i18n";
import { pearIconBitmap } from "@pear/sdk/icon";
import { type CoreSection, STARTING_PAGES, type StartingPage } from "@pear/sdk/core-config";
import { CHANNEL, type CoreState, type HostEvent } from "@pear/sdk/protocol";
import hostPlugins from "virtual:pear/host-plugins";
import { chromeUserAgent, isGoogleAuth, YTM_ORIGIN } from "../shared/user-agent.ts";
import { ApiServer } from "./api/index.ts";
import { hideOnClose, onActivate } from "./close.ts";
import { Settings, type WindowState } from "./config.ts";
import { seedConsent } from "./consent.ts";
import { loadI18n, resolveLanguage } from "./i18n.ts";
import { setupIpc } from "./ipc.ts";
import { applyHideMenu, setApplicationMenu, syncMenu } from "./menu.ts";
import { setupNet } from "./net.ts";
import { PageRequests } from "./page-requests.ts";
import { PlayerMirror } from "./player.ts";
import { PluginHost } from "./plugins.ts";
import { openSettingsWindow, registerSettingsScheme, serveSettings, settingsWindowContents } from "./settings-window.ts";
import { Themes } from "./themes.ts";
import { CHECK_DELAY_MS, checkForUpdates, shouldCheck } from "./updates.ts";
import { WebRequestRouter } from "./web-request.ts";

const YTM_URL = `${YTM_ORIGIN}/`;
const APP_NAME = "\u0059\u006f\u0075\u0054\u0075\u0062\u0065\u0020\u004d\u0075\u0073\u0069\u0063";
/** Like pear-desktop: clear the cache once the page has settled. */
const CLEAR_CACHE_DELAY_MS = 20_000;

// Separate profile (and single-instance lock) for tests and parallel dev runs.
if (process.env.PEAR_USER_DATA) app.setPath("userData", process.env.PEAR_USER_DATA);

// Same identity as pear-desktop. The data folder follows productName, so pin it
// before renaming the app to its id, which X11/Wayland use as the window class
// and Windows as the AppUserModelId.
const APP_ID = "com.github.th-ch.\u0079\u006f\u0075\u0074\u0075\u0062\u0065\u002d\u006d\u0075\u0073\u0069\u0063";
app.setPath("userData", app.getPath("userData"));
app.setName(APP_ID);
app.commandLine.appendSwitch("class", APP_ID);
if (process.platform === "win32") app.setAppUserModelId(APP_ID);

/** `--settings` opens the standalone settings window (also in an already running instance). */
const SETTINGS_FLAG = "--settings";

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  main();
}

function main() {
  const settings = new Settings(app.getPath("userData"), hostPlugins, app.getVersion());
  const plugins = new PluginHost(hostPlugins, settings, process.platform);
  if (settings.core("advanced").disableHardwareAcceleration) app.disableHardwareAcceleration();
  registerSettingsScheme();
  const features = plugins.beforeReady(app);
  if (features.enabled.size > 0) app.commandLine.appendSwitch("enable-features", [...features.enabled].join(","));
  if (features.disabled.size > 0) app.commandLine.appendSwitch("disable-features", [...features.disabled].join(","));

  let mainWindow: BrowserWindow | undefined;
  // Whether the page runtime of the current main-window page is up (it can show the in-page settings).
  let runtimeUp = false;
  let electronUserAgent = "";
  let ytmUserAgent = "";

  const send = (event: HostEvent) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(CHANNEL.event, event);
    // The standalone settings window only follows state, not page-runtime traffic.
    if (event.type === "plugin-state" || event.type === "plugin-error" || event.type === "plugin-status" || event.type === "core-state") {
      settingsWindowContents()?.send(CHANNEL.event, event);
    }
  };

  /** The in-page overlay when YTM is up, otherwise the standalone window. */
  const openSettings = () => {
    const window = mainWindow;
    if (!window || window.isDestroyed() || !runtimeUp) return void openSettingsWindow();
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    send({ type: "ui", action: "open-settings" });
  };

  const t: Translate = (key, fallback, vars) => (plugins.i18n ? plugins.i18n.t(key, fallback, vars) : interpolate(fallback ?? key, vars));

  const themes = new Themes(() => {
    send({ type: "themes", css: themes.css });
    send({ type: "core-state", section: "appearance", state: coreState("appearance") });
  });

  /** A core section's state for the settings UI and the page. */
  const coreState = (section: Exclude<CoreSection, "apiServer">): CoreState => {
    const state: CoreState = { config: settings.core(section) };
    if (section === "appearance" && themes.missing.length > 0) {
      state.error = themes.missing
        .map((cssFile) => t("main.console.theme.css-file-not-found", 'CSS file "{{cssFile}}" does not exist, ignoring', { cssFile }))
        .join("\n");
    }
    return state;
  };

  /** The custom window title, or the page's. */
  const windowTitle = (window: BrowserWindow) =>
    settings.core("appearance").customWindowTitle || window.webContents.getTitle() || APP_NAME;

  /** Applies the core options that take effect live. */
  const applyCore = (section: CoreSection) => {
    const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
    if (section === "window") {
      const options = settings.core("window");
      syncMenu(options.alwaysOnTop);
      if (!window) return;
      window.setAlwaysOnTop(options.alwaysOnTop);
      if (process.platform !== "darwin") applyHideMenu(window, options.hideMenu);
      if (process.platform === "win32" || process.platform === "darwin") {
        app.setLoginItemSettings({ openAtLogin: options.startAtLogin, args: [] });
      }
    } else if (section === "appearance") {
      // The page applies the rest itself (core-state events).
      if (themes.set(settings.core("appearance").themes)) send({ type: "themes", css: themes.css });
      if (window) window.setTitle(windowTitle(window));
    }
  };

  /** Changes core options like the settings UI does (and tells it). */
  const setCore = (section: Exclude<CoreSection, "apiServer">, patch: Record<string, unknown>) => {
    settings.setCore(section, patch);
    applyCore(section);
    send({ type: "core-state", section, state: coreState(section) });
  };
  const player = new PlayerMirror((action) => send({ type: "player-control", action }));
  const requests = new PageRequests(send);
  let api: ApiServer | undefined;

  function createWindow() {
    const saved = settings.window;
    const pluginOptions = plugins.windowOptions();
    const window = new BrowserWindow({
      minWidth: 360,
      minHeight: 300,
      backgroundColor: "#030303",
      alwaysOnTop: settings.core("window").alwaysOnTop,
      title: settings.core("appearance").customWindowTitle || APP_NAME,
      icon: nativeImage.createFromBitmap(pearIconBitmap(256), { width: 256, height: 256 }),
      autoHideMenuBar: settings.core("window").hideMenu,
      // Plugins may override the defaults above (frame, transparency, colors)…
      ...pluginOptions,
      // …but not geometry, visibility or the security-relevant preferences below.
      ...windowBounds(saved),
      show: false,
      webPreferences: {
        ...pluginOptions.webPreferences,
        preload: join(import.meta.dirname, "../preload/index.cjs"),
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    if (saved?.maximized) window.maximize();
    window.once("ready-to-show", () => {
      // Hidden starts only make sense with a tray icon to bring the window back.
      if (!settings.core("window").appVisible && settings.plugin("tray")?.enabled) return;
      window.show();
      console.info(`[pear] startup: window shown after ${Math.round(performance.now())}ms`);
    });

    // The custom title stays put; without one the window follows the page's.
    window.on("page-title-updated", (event) => {
      if (!settings.core("appearance").customWindowTitle) return;
      event.preventDefault();
      window.setTitle(windowTitle(window));
    });

    // YTM asks "leave page?" while playing, which would silently cancel quitting.
    window.webContents.on("will-prevent-unload", (event) => event.preventDefault());

    // Keep navigator.userAgent consistent with the UA header per destination.
    window.webContents.on("did-start-navigation", ({ url, isMainFrame, isSameDocument }) => {
      if (!isMainFrame) return;
      if (!isSameDocument) runtimeUp = false;
      const userAgent = isGoogleAuth(url) ? electronUserAgent : ytmUserAgent;
      if (window.webContents.getUserAgent() !== userAgent) window.webContents.setUserAgent(userAgent);
    });
    window.webContents.on("did-navigate-in-page", (_, url, isMainFrame) => {
      if (isMainFrame && URL.parse(url)?.origin === YTM_ORIGIN) settings.lastUrl = url;
    });

    const saveBounds = () => {
      if (window.isDestroyed() || window.isMinimized()) return;
      const maximized = window.isMaximized();
      const bounds = maximized ? (settings.window ?? window.getNormalBounds()) : window.getBounds();
      settings.window = { ...bounds, maximized };
    };
    window.on("resize", saveBounds);
    window.on("move", saveBounds);
    window.on("maximize", saveBounds);
    window.on("unmaximize", saveBounds);

    window.webContents.on("render-process-gone", () => (runtimeUp = false));
    window.loadURL(startUrl(settings.core("general"), settings.lastUrl));
    return window;
  }

  app.on("second-instance", (_, argv) => {
    if (argv.includes(SETTINGS_FLAG)) return void openSettingsWindow();
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    console.info(`[pear] startup: app ready after ${Math.round(performance.now())}ms`);
    plugins.setI18n(loadI18n(resolveLanguage(settings.core("general").language, app.getLocale())));
    electronUserAgent = app.userAgentFallback;
    ytmUserAgent = chromeUserAgent(electronUserAgent);
    app.userAgentFallback = ytmUserAgent;
    const router = new WebRequestRouter(session.defaultSession);
    setupNet(router.scoped("core"), { electronUserAgent });
    serveSettings();
    setupIpc({
      plugins,
      player,
      requests,
      settingsPath: settings.path,
      onRuntimeBootstrap: (sender) => {
        if (mainWindow && sender === mainWindow.webContents) runtimeUp = true;
      },
      core: {
        states: () => ({
          general: coreState("general"),
          window: coreState("window"),
          appearance: coreState("appearance"),
          advanced: coreState("advanced"),
          apiServer: api?.state() ?? { config: settings.core("apiServer") },
        }),
        async setConfig(section, patch) {
          if (section !== "apiServer") return setCore(section, patch);
          settings.setCore(section, patch);
          await api?.apply();
        },
        themes: () => themes.css,
      },
    });
    themes.set(settings.core("appearance").themes);
    setApplicationMenu({
      platform: process.platform,
      t,
      window: () => mainWindow,
      openSettings,
      alwaysOnTop: () => settings.core("window").alwaysOnTop,
      setAlwaysOnTop: (alwaysOnTop) => setCore("window", { alwaysOnTop }),
      settingsPath: settings.path,
      restart: () => {
        app.relaunch();
        app.quit();
      },
    });
    await seedConsent(session.defaultSession);
    await applyProxy(settings.core("advanced").proxy, Boolean(settings.plugin("auth-proxy-adapter")?.enabled));
    mainWindow = createWindow();
    const window = mainWindow;
    if (process.platform === "darwin") hideOnClose(app, window);
    api = new ApiServer({
      settings,
      plugins,
      player,
      requests,
      window,
      publish: (state) => send({ type: "core-state", section: "apiServer", state }),
    });
    plugins.attach({
      app,
      window,
      session: session.defaultSession,
      router,
      player,
      requests,
      send,
      openSettings,
      broadcast: (plugin, event, data) => api?.broadcastPluginEvent(plugin, event, data),
    });
    applyCore("window");
    void api.apply();
    if (process.argv.includes(SETTINGS_FLAG)) openSettingsWindow();

    if (settings.core("advanced").autoResetAppCache) {
      setTimeout(() => {
        console.info("[pear] clearing the app cache");
        void session.defaultSession.clearCache();
      }, CLEAR_CACHE_DELAY_MS);
    }
    if (shouldCheck({ packaged: app.isPackaged, enabled: settings.core("general").autoUpdates })) {
      setTimeout(() => {
        void checkForUpdates({
          currentVersion: app.getVersion(),
          window: () => mainWindow,
          t,
          disable: () => setCore("general", { autoUpdates: false }),
        });
      }, CHECK_DELAY_MS);
    }
  });

  app.on("before-quit", () => {
    themes.stop();
    api?.stop();
    plugins.stopAll();
    settings.flush();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => onActivate(mainWindow, () => void (mainWindow = createWindow())));
}

/**
 * advanced.proxy, from the first request on. The Proxy plugin (which also
 * handles credentials) takes precedence when it's enabled, as in pear-desktop.
 */
async function applyProxy(proxy: string, pluginEnabled: boolean) {
  if (!proxy.trim() || pluginEnabled) return;
  try {
    await session.defaultSession.setProxy({ mode: "fixed_servers", proxyRules: proxy.trim() });
    console.info(`[pear] using proxy ${proxy.trim()}`);
  } catch (error) {
    console.error(`[pear] invalid proxy "${proxy}":`, error);
  }
}

/** The last YTM page (never straight into a track) if enabled, otherwise the starting page. */
function startUrl(general: { resumeOnStart: boolean; startingPage: StartingPage }, lastUrl: string | undefined) {
  const last = general.resumeOnStart && lastUrl ? URL.parse(lastUrl) : null;
  if (last && last.origin === YTM_ORIGIN && last.pathname !== "/watch") return last.toString();
  return new URL(STARTING_PAGES[general.startingPage] ?? "/", YTM_URL).toString();
}

function windowBounds(saved: WindowState | undefined) {
  const defaults = { width: 1280, height: 800 };
  if (!saved) return defaults;
  const { x, y, width, height } = saved;
  if (x === undefined || y === undefined) return { width, height };
  // Ignore positions on displays that are no longer connected.
  const visible = screen.getAllDisplays().some(({ workArea: a }) =>
    x < a.x + a.width && x + width > a.x && y < a.y + a.height && y + height > a.y,
  );
  return visible ? { x, y, width, height } : { width, height };
}
