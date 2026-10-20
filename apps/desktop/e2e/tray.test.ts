// tray: pear-desktop's tray icon, menu and paused icon. Electron's Tray is
// observed by wrapping its prototype before the plugin starts.

import { expect, test } from "@playwright/test";
import { closeApp, setEnabled, waitForTrackPlaying } from "./audio-helpers.ts";
import { launchApp, mainWindow, playTestTrack } from "./launch.ts";

declare global {
  // Main-process probe state.
  var __trayProbe: { images: number[]; menu: string[] } | undefined;
}

test("tray shows a paused icon while paused and offers Restart", async () => {
  test.setTimeout(180_000);
  const app = await launchApp({ plugins: { tray: { enabled: false } } });
  try {
    const page = await mainWindow(app);
    await app.evaluate(({ Tray }) => {
      const probe = { images: [] as number[], menu: [] as string[] };
      globalThis.__trayProbe = probe;
      const setImage = Tray.prototype.setImage;
      Tray.prototype.setImage = function (this: Electron.Tray, image: Electron.NativeImage | string) {
        // The icons differ in their pixels; a checksum tells them apart.
        const bitmap = typeof image === "string" ? Buffer.alloc(0) : image.toBitmap();
        probe.images.push(bitmap.reduce((sum, byte) => (sum + byte) % 1_000_003, 0));
        return setImage.call(this, image);
      };
      const setContextMenu = Tray.prototype.setContextMenu;
      Tray.prototype.setContextMenu = function (this: Electron.Tray, menu: Electron.Menu | null) {
        probe.menu = menu?.items.map((item) => item.label) ?? [];
        return setContextMenu.call(this, menu);
      };
    });
    await setEnabled(page, "tray", true);
    await playTestTrack(page);
    await waitForTrackPlaying(page);
    const probe = () => app.evaluate(() => globalThis.__trayProbe!);
    await expect.poll(async () => (await probe()).menu).toContain("Restart App");

    // Playing: the regular icon (set on the first change away from the initial one, if any).
    const before = (await probe()).images.length;
    await page.evaluate(() => window.__pearRuntime!.player.control({ type: "pause" }));
    await expect.poll(async () => (await probe()).images.length).toBe(before + 1);
    const paused = (await probe()).images.at(-1);
    await page.evaluate(() => window.__pearRuntime!.player.control({ type: "play" }));
    await expect.poll(async () => (await probe()).images.length).toBe(before + 2);
    expect((await probe()).images.at(-1)).not.toBe(paused);
  } finally {
    await closeApp(app);
  }
});
