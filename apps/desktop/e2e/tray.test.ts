// tray: pear-desktop's tray icon, menu and paused icon. Electron's Tray is
// observed by wrapping its prototype before the plugin starts.

import { expect, test } from "./fixtures.ts";
import { pause, waitForTrackPlaying } from "./helpers/playback.ts";
import { setEnabled } from "./helpers/plugins.ts";
import "./helpers/probes.ts";
import { playTestTrack } from "./launch.ts";

test.use({ appOptions: { plugins: { tray: { enabled: false } } } });

test("tray shows a paused icon while paused and offers Restart", async ({ app, page }) => {
  test.setTimeout(180_000);
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
  await pause(page);
  await expect.poll(async () => (await probe()).images.length).toBe(before + 1);
  const paused = (await probe()).images.at(-1);
  await page.evaluate(() => window.__pearRuntime!.player.control({ type: "play" }));
  await expect.poll(async () => (await probe()).images.length).toBe(before + 2);
  expect((await probe()).images.at(-1)).not.toBe(paused);
});

test("tray menu has plugins' items above Settings, while they run", async ({ app, page }) => {
  await app.evaluate(({ Tray }) => {
    const probe = { images: [] as number[], menu: [] as string[] };
    globalThis.__trayProbe = probe;
    const setContextMenu = Tray.prototype.setContextMenu;
    Tray.prototype.setContextMenu = function (this: Electron.Tray, menu: Electron.Menu | null) {
      probe.menu = menu?.items.map((item) => item.label) ?? [];
      return setContextMenu.call(this, menu);
    };
  });
  await setEnabled(page, "tray", true);
  const menu = async () => (await app.evaluate(() => globalThis.__trayProbe!)).menu;
  await expect.poll(menu).toContain("Settings…");
  expect(await menu()).not.toContain("Downloads");

  await setEnabled(page, "downloader", true);
  await expect.poll(async () => (await menu()).filter((label) => label === "Downloads" || label === "Settings…")).toEqual(["Downloads", "Settings…"]);
  await setEnabled(page, "downloader", false);
  await expect.poll(menu).not.toContain("Downloads");
});
