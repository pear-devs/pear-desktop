import { join } from "node:path";
import { app, BrowserWindow, nativeImage, screen, session } from "electron";
import { pearIconBitmap } from "@pear/sdk/icon";
import { CHANNEL, type HostEvent } from "@pear/sdk/protocol";
import hostPlugins from "virtual:pear/host-plugins";
import { chromeUserAgent, isGoogleAuth, YTM_ORIGIN } from "../shared/user-agent.ts";
import { Settings, type WindowState } from "./config.ts";
import { seedConsent } from "./consent.ts";
import { setupIpc } from "./ipc.ts";
import { setupNet } from "./net.ts";
import { PlayerMirror } from "./player.ts";
import { PluginHost } from "./plugins.ts";
import { WebRequestRouter } from "./web-request.ts";

const YTM_URL = `${YTM_ORIGIN}/`;

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

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  main();
}

function main() {
  const settings = new Settings(app.getPath("userData"), hostPlugins);
  const plugins = new PluginHost(hostPlugins, settings, process.platform);
  const features = plugins.beforeReady(app);
  if (features.enabled.size > 0) app.commandLine.appendSwitch("enable-features", [...features.enabled].join(","));
  if (features.disabled.size > 0) app.commandLine.appendSwitch("disable-features", [...features.disabled].join(","));

  let mainWindow: BrowserWindow | undefined;
  let electronUserAgent = "";
  let ytmUserAgent = "";

  const send = (event: HostEvent) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(CHANNEL.event, event);
  };
  const player = new PlayerMirror((action) => send({ type: "player-control", action }));

  function createWindow() {
    const saved = settings.window;
    const pluginOptions = plugins.windowOptions();
    const window = new BrowserWindow({
      minWidth: 360,
      minHeight: 300,
      backgroundColor: "#030303",
      title: "\u0059\u006f\u0075\u0054\u0075\u0062\u0065\u0020\u004d\u0075\u0073\u0069\u0063",
      icon: nativeImage.createFromBitmap(pearIconBitmap(256), { width: 256, height: 256 }),
      autoHideMenuBar: true,
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
      window.show();
      console.info(`[pear] startup: window shown after ${Math.round(performance.now())}ms`);
    });

    // YTM asks "leave page?" while playing, which would silently cancel quitting.
    window.webContents.on("will-prevent-unload", (event) => event.preventDefault());

    // Keep navigator.userAgent consistent with the UA header per destination.
    window.webContents.on("did-start-navigation", ({ url, isMainFrame }) => {
      if (!isMainFrame) return;
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

    window.loadURL(resumeUrl(settings.lastUrl));
    return window;
  }

  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    console.info(`[pear] startup: app ready after ${Math.round(performance.now())}ms`);
    electronUserAgent = app.userAgentFallback;
    ytmUserAgent = chromeUserAgent(electronUserAgent);
    app.userAgentFallback = ytmUserAgent;
    const router = new WebRequestRouter(session.defaultSession);
    setupNet(router.scoped("core"), { electronUserAgent });
    setupIpc(plugins, player);
    await seedConsent(session.defaultSession);
    mainWindow = createWindow();
    plugins.attach({ app, window: mainWindow, session: session.defaultSession, router, player, send });
  });

  app.on("before-quit", () => {
    plugins.stopAll();
    settings.flush();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
}

/** Restores the last YTM page, but never auto-resumes into a specific track. */
function resumeUrl(lastUrl: string | undefined) {
  const url = lastUrl ? URL.parse(lastUrl) : null;
  if (!url || url.origin !== YTM_ORIGIN || url.pathname === "/watch") return YTM_URL;
  return url.toString();
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
