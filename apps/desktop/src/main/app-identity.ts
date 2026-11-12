// Same identity as pear-desktop, so existing installs keep their data folder,
// window class and taskbar entry.

import { dirname, join } from "node:path";
import { app, shell } from "electron";

export const APP_ID = "com.github.th-ch.\u0079\u006f\u0075\u0074\u0075\u0062\u0065\u002d\u006d\u0075\u0073\u0069\u0063";
export const APP_NAME = "\u0059\u006f\u0075\u0054\u0075\u0062\u0065\u0020\u004d\u0075\u0073\u0069\u0063";

/** Must run first, before anything reads userData. */
export function setAppIdentity() {
  // Separate profile (and single-instance lock) for tests and parallel dev runs.
  if (process.env.PEAR_USER_DATA) app.setPath("userData", process.env.PEAR_USER_DATA);
  // The data folder follows productName, so pin it before renaming the app to its
  // id, which X11/Wayland use as the window class and Windows as the AppUserModelId.
  app.setPath("userData", app.getPath("userData"));
  app.setName(APP_ID);
  app.commandLine.appendSwitch("class", APP_ID);
  if (process.platform === "win32") app.setAppUserModelId(APP_ID);
}

/**
 * Restarts the app. A portable Windows build runs from a temporary copy it
 * extracts; relaunching that copy would lose the portable exe (and its folder).
 */
export function relaunchOptions(): Electron.RelaunchOptions {
  const portable = process.env.PORTABLE_EXECUTABLE_FILE;
  return portable ? { execPath: portable } : {};
}

/**
 * Windows: a Start Menu shortcut with the app's id, created or repaired at each
 * start, as pear-desktop did. Windows shows notifications (toasts) only for apps
 * with one, and groups the taskbar by its id. Not in development, nor for a
 * portable build, which runs from a temporary folder.
 */
export function registerStartMenuShortcut() {
  if (process.platform !== "win32" || !app.isPackaged) return;
  const target = process.execPath;
  const appData = app.getPath("appData");
  if (process.env.PORTABLE_EXECUTABLE_FILE || target.startsWith(join(appData, "..", "Local", "Temp"))) return;
  const shortcut = join(appData, "Microsoft", "Windows", "Start Menu", "Programs", `${APP_NAME}.lnk`);
  const details = { target, cwd: dirname(target), description: `${APP_NAME} Desktop App - including custom plugins`, appUserModelId: APP_ID };
  let operation: "create" | "update" = "create";
  try {
    const current = shell.readShortcutLink(shortcut);
    if (current.target === target && current.appUserModelId === APP_ID) return;
    operation = "update";
  } catch {
    // No shortcut yet.
  }
  if (!shell.writeShortcutLink(shortcut, operation, details)) console.warn(`[pear] couldn't ${operation} the Start Menu shortcut`);
}
