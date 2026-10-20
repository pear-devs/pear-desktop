// The standalone settings window: the same settings UI as the in-page overlay,
// served from pear://settings, so settings stay reachable when YTM
// doesn't load (a broken plugin, no network…).

import { join } from "node:path";
import { BrowserWindow, nativeImage, protocol } from "electron";
import { pearIconBitmap } from "@pear/sdk/icon";
import { SETTINGS_ORIGIN } from "@pear/sdk/protocol";
import settingsApp from "virtual:pear/settings-app";
import { isSettingsUrl } from "../shared/user-agent.ts";

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src data:">
<title>Pear Desktop settings</title>
<style>html, body { margin: 0; height: 100%; background: #1d1b20; }</style>
</head>
<body><script src="app.js"></script></body>
</html>`;

/** Must run before `app.whenReady()`. */
export function registerSettingsScheme() {
  protocol.registerSchemesAsPrivileged([{ scheme: "pear", privileges: { standard: true, secure: true } }]);
}

/** Must run after `app.whenReady()`. */
export function serveSettings() {
  protocol.handle("pear", (request) => {
    const url = new URL(request.url);
    if (!isSettingsUrl(request.url)) return new Response("Not found", { status: 404 });
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(PAGE, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    if (url.pathname === "/app.js") {
      return new Response(settingsApp, { headers: { "Content-Type": "text/javascript; charset=utf-8" } });
    }
    return new Response("Not found", { status: 404 });
  });
}

let settingsWindow: BrowserWindow | undefined;

export function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (settingsWindow.isMinimized()) settingsWindow.restore();
    settingsWindow.show();
    settingsWindow.focus();
    return settingsWindow;
  }
  const window = new BrowserWindow({
    width: 900,
    height: 680,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: "#1d1b20",
    title: "Pear Desktop settings",
    icon: nativeImage.createFromBitmap(pearIconBitmap(256), { width: 256, height: 256 }),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  settingsWindow = window;
  window.on("closed", () => {
    if (settingsWindow === window) settingsWindow = undefined;
  });
  window.once("ready-to-show", () => window.show());
  // Links (none today) open nowhere inside this window.
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  void window.loadURL(`${SETTINGS_ORIGIN}/`);
  return window;
}

export function settingsWindowContents() {
  return settingsWindow && !settingsWindow.isDestroyed() ? settingsWindow.webContents : undefined;
}
