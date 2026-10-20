// The main process: builds the app's parts and wires them together.

import { app, session } from "electron";
import hostPlugins from "virtual:pear/host-plugins";
import { ApiServer } from "./api/index.ts";
import { setAppIdentity } from "./app-identity.ts";
import { hideOnClose, onActivate } from "./close.ts";
import { Settings } from "./config.ts";
import { seedConsent } from "./consent.ts";
import { CoreOptions } from "./core-options.ts";
import { loadI18n, resolveLanguage } from "./i18n.ts";
import { setupIpc } from "./ipc.ts";
import { MainWindow } from "./main-window.ts";
import { setApplicationMenu } from "./menu.ts";
import { setupNet } from "./net.ts";
import { PageRequests } from "./page-requests.ts";
import { PlayerMirror } from "./player.ts";
import { PluginHost } from "./plugins.ts";
import { findProtocolLink, ProtocolLinks, registerProtocol } from "./protocol.ts";
import { openSettingsWindow, SETTINGS_FLAG, serveSettings } from "./settings-window.ts";
import { applyProxy, beforeReady, scheduleLaterTasks } from "./startup-tasks.ts";
import { WebRequestRouter } from "./web-request.ts";
import { focusWindow } from "./windows.ts";

setAppIdentity();
if (!app.requestSingleInstanceLock()) app.quit();
else main();

function main() {
  const settings = new Settings(app.getPath("userData"), hostPlugins, app.getVersion());
  const plugins = new PluginHost(hostPlugins, settings, process.platform);
  beforeReady(app, settings, plugins);

  const mainWindow = new MainWindow(settings, plugins);
  const { send, openSettings } = mainWindow;
  const core = new CoreOptions(settings, plugins.t, mainWindow);
  const player = new PlayerMirror((action) => send({ type: "player-control", action }));
  const requests = new PageRequests(send);
  // pear-desktop's app protocol: links control playback; plugins hear about them too.
  const links = new ProtocolLinks((action) => player.control(action));
  let api: ApiServer | undefined;

  links.handleOpenUrl(app);
  app.on("second-instance", (_, argv) => {
    const link = findProtocolLink(argv);
    if (link) links.run(link);
    else if (argv.includes(SETTINGS_FLAG)) openSettingsWindow();
    else mainWindow.focus();
  });

  app.whenReady().then(async () => {
    console.info(`[pear] startup: app ready after ${Math.round(performance.now())}ms`);
    plugins.setI18n(loadI18n(resolveLanguage(settings.core("general").language, app.getLocale())));
    const router = new WebRequestRouter(session.defaultSession);
    setupNet(router.scoped("core"), { electronUserAgent: mainWindow.useYtmUserAgent() });
    serveSettings();
    setupIpc({
      plugins,
      player,
      requests,
      settingsPath: settings.path,
      onRuntimeBootstrap: (sender) => mainWindow.runtimeBootstrapped(sender),
      core: {
        states: () => ({ ...core.states(), apiServer: api?.state() ?? { config: settings.core("apiServer") } }),
        async setConfig(section, patch) {
          if (section !== "apiServer") return core.set(section, patch);
          settings.setCore(section, patch);
          await api?.apply();
        },
        themes: () => core.themes.css,
      },
    });
    core.start();
    setApplicationMenu({
      platform: process.platform,
      t: plugins.t,
      window: () => mainWindow.window,
      openSettings,
      alwaysOnTop: () => settings.core("window").alwaysOnTop,
      setAlwaysOnTop: (alwaysOnTop) => core.set("window", { alwaysOnTop }),
      settingsPath: settings.path,
      restart: () => {
        app.relaunch();
        app.quit();
      },
    });
    await seedConsent(session.defaultSession);
    await applyProxy(settings);

    const window = mainWindow.create();
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
      focusWindow: () => focusWindow(window),
      broadcast: (plugin, event, data) => api?.broadcastPluginEvent(plugin, event, data),
      onProtocol: (listener) => links.listen(listener),
    });
    registerProtocol(app);
    core.apply("window");
    void api.apply();
    if (process.argv.includes(SETTINGS_FLAG)) openSettingsWindow();
    scheduleLaterTasks({
      app,
      settings,
      t: plugins.t,
      window: () => mainWindow.window,
      disableUpdates: () => core.set("general", { autoUpdates: false }),
    });
  });

  app.on("before-quit", () => {
    core.stop();
    api?.stop();
    plugins.stopAll();
    settings.flush();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => onActivate(mainWindow.window, () => void mainWindow.create()));
}
