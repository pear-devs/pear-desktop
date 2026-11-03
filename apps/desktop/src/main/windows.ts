import { join } from "node:path";
import { type BrowserWindow, nativeImage, type WebPreferences } from "electron";
import { pearIconBitmap } from "@pear/sdk/icon";

const ICON_SIZE = 256;

/** The window, unless it is gone (closed windows throw on most calls). */
export function alive(window: BrowserWindow | null | undefined) {
  return window && !window.isDestroyed() ? window : undefined;
}

/** Shows the window and brings it to the front, restoring it if minimized. */
export function focusWindow(window: BrowserWindow) {
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

/** The pear icon of the app's windows. A function, so importing this module needs no Electron (unit tests). */
export function appIcon() {
  return nativeImage.createFromBitmap(pearIconBitmap(ICON_SIZE), { width: ICON_SIZE, height: ICON_SIZE });
}

/** What every app window runs with: the preload bridge in an isolated, sandboxed renderer. */
export function secureWebPreferences(): WebPreferences {
  return {
    preload: join(import.meta.dirname, "../preload/index.cjs"),
    contextIsolation: true,
    sandbox: true,
  };
}
