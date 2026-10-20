// Close-to-tray, set in the tray plugin or carried over from pear-desktop's options.

import { expect, test } from "./fixtures.ts";
import { setEnabled } from "./helpers/plugins.ts";
import type {} from "./helpers/probes.ts";
import { closeMainWindow, windowsVisible } from "./helpers/window.ts";
import { type App, mainWindow } from "./launch.ts";

/** Closing the window hides it; the app keeps running. */
async function expectClosesToTray(app: App) {
  await mainWindow(app);
  await closeMainWindow(app);
  await expect.poll(() => windowsVisible(app)).toEqual([{ visible: false }]);
}

test.describe(() => {
  test.use({ appOptions: { plugins: { tray: { enabled: true, config: { closeToTray: true } } } } });

  test("tray: close-to-tray hides instead of quitting", async ({ app }) => {
    await expectClosesToTray(app);
  });

  test("tray: turning it off brings back a window hidden in it", async ({ app, page }) => {
    await expectClosesToTray(app);
    // An error in the main process would otherwise only show up as Electron's alert.
    await app.evaluate(() => {
      globalThis.__mainErrors = [];
      process.on("uncaughtException", (error) => globalThis.__mainErrors!.push(String(error)));
    });
    await setEnabled(page, "tray", false);
    await expect.poll(() => windowsVisible(app)).toEqual([{ visible: true }]);
    expect(await app.evaluate(() => globalThis.__mainErrors)).toEqual([]);
  });
});

test.describe(() => {
  test.use({ appOptions: { config: { options: { tray: true }, __internal__: { migrations: { version: "3.12.0" } } } } });

  test("pear-desktop's tray users keep close-to-tray", async ({ app }) => {
    await expectClosesToTray(app);
  });
});
