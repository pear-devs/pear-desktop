import type { BrowserWindow } from "electron";

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
