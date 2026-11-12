// The main window, seen from the main process.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ElectronApplication } from "@playwright/test";

/** Lets the compositor catch up with the last DOM change before a screenshot. */
const COMPOSITOR_MS = 600;

export const windowInfo = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]!;
    return {
      bounds: window.getBounds(),
      maximized: window.isMaximized(),
      alwaysOnTop: window.isAlwaysOnTop(),
      background: window.getBackgroundColor(),
      zoom: window.webContents.getZoomLevel(),
      visible: window.isVisible(),
    };
  });

export const isAlwaysOnTop = async (app: ElectronApplication) => (await windowInfo(app)).alwaysOnTop;

/** Whether each window is visible. */
export const windowsVisible = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((window) => ({ visible: window.isVisible() })));

export const closeMainWindow = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());

/** Set PEAR_SCREENSHOTS=<dir> to save screenshots of the window for a visual check. */
export async function screenshot(app: ElectronApplication, name: string) {
  const dir = process.env.PEAR_SCREENSHOTS;
  if (!dir) return;
  await new Promise((resolve) => setTimeout(resolve, COMPOSITOR_MS));
  const png = await app.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString("base64"),
  );
  writeFileSync(join(dir, `${name}.png`), Buffer.from(png, "base64"));
}
