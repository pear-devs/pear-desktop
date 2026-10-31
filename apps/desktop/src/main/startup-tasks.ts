// What runs around startup besides building the app: the command line switches
// (before the app is ready), the proxy (before the first request), and the
// cache clearing and update check (a while after the window is up).

import { type App, type BrowserWindow, session } from "electron";
import type { Translate } from "@pear/sdk/i18n";
import type { Settings } from "./config.ts";
import type { PluginHost } from "./plugins.ts";
import { registerSettingsScheme } from "./settings-window.ts";
import { CHECK_DELAY_MS, checkForUpdates, shouldCheck } from "./updates.ts";

/** Like pear-desktop: clear the cache once the page has settled. */
const CLEAR_CACHE_DELAY_MS = 20_000;

/** Must run before `app.whenReady()`. */
export function beforeReady(app: App, settings: Settings, plugins: PluginHost) {
  if (settings.core("advanced").disableHardwareAcceleration) app.disableHardwareAcceleration();
  registerSettingsScheme();
  const features = plugins.beforeReady(app);
  if (features.enabled.size > 0) app.commandLine.appendSwitch("enable-features", [...features.enabled].join(","));
  if (features.disabled.size > 0) app.commandLine.appendSwitch("disable-features", [...features.disabled].join(","));
}

/** The Proxy plugin: while on, it owns the session's proxy. */
export const PROXY_PLUGIN = "auth-proxy-adapter";

/**
 * advanced.proxy, from the first request on (and again when the Proxy plugin is
 * turned off). The Proxy plugin (which also handles credentials) takes
 * precedence when it's enabled, as in pear-desktop.
 */
export async function applyProxy(settings: Settings) {
  const proxy = settings.core("advanced").proxy;
  const pluginEnabled = Boolean(settings.plugin(PROXY_PLUGIN)?.enabled);
  if (!proxy.trim() || pluginEnabled) return;
  try {
    await session.defaultSession.setProxy({ mode: "fixed_servers", proxyRules: proxy.trim() });
    // Connections opened before keep their old route otherwise (after the Proxy plugin was turned off).
    await session.defaultSession.closeAllConnections();
    console.info(`[pear] using proxy ${proxy.trim()}`);
  } catch (error) {
    console.error(`[pear] invalid proxy "${proxy}":`, error);
  }
}

export interface LaterTasksEnvironment {
  app: App;
  settings: Settings;
  t: Translate;
  window(): BrowserWindow | undefined;
  /** "Disable updates" was chosen in the update dialog. */
  disableUpdates(): void;
}

/** The cache clearing and update check, each after its delay. */
export function scheduleLaterTasks({ app, settings, t, window, disableUpdates }: LaterTasksEnvironment) {
  if (settings.core("advanced").autoResetAppCache) {
    setTimeout(() => {
      console.info("[pear] clearing the app cache");
      void session.defaultSession.clearCache();
    }, CLEAR_CACHE_DELAY_MS);
  }
  if (shouldCheck({ packaged: app.isPackaged, enabled: settings.core("general").autoUpdates })) {
    setTimeout(() => {
      void checkForUpdates({ currentVersion: app.getVersion(), window, t, disable: disableUpdates });
    }, CHECK_DELAY_MS);
  }
}
