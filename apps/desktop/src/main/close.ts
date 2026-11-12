// pear-desktop's window lifecycle on macOS: closing the window only hides it, so
// the page and playback keep running, and the dock icon brings the same window
// back. Quitting (Cmd+Q, the menu, the tray, an update) still closes it.

import type { App, BrowserWindow } from "electron";

export function hideOnClose(app: Pick<App, "on">, window: Pick<BrowserWindow, "on" | "hide">) {
  let quitting = false;
  app.on("before-quit", () => {
    quitting = true;
  });
  window.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    window.hide();
  });
}

/** The dock icon: shows the hidden window, or opens one if there is none (pear-desktop's `activate`). */
export function onActivate(window: Pick<BrowserWindow, "isDestroyed" | "isVisible" | "show"> | undefined, create: () => void) {
  if (!window || window.isDestroyed()) create();
  else if (!window.isVisible()) window.show();
}
