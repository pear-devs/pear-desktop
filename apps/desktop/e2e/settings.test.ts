// Milestone 3: the settings overlay drives plugins live and persists to disk.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { launchApp, mainWindow } from "./launch.ts";

const overlay = (page: Page) => page.locator("pear-settings");
const pluginRow = (page: Page, id: string) => overlay(page).locator(`[data-plugin="${id}"]`);
const enabled = (page: Page, id: string) =>
  page.evaluate((id) => window.__pearRuntime!.plugins.state(id)?.enabled, id);
const pluginConfig = (page: Page, id: string) =>
  page.evaluate((id) => window.__pearRuntime!.plugins.state(id)?.config, id);
const savedSettings = (userData: string) => JSON.parse(readFileSync(join(userData, "config.json"), "utf8"));

test("opens from the shortcut and the nav-bar launcher, closes with Escape", async () => {
  const app = await launchApp();
  try {
    const page = await mainWindow(app);
    const dialog = overlay(page).getByRole("dialog");

    await page.waitForFunction(() => window.__pearRuntime?.settings);
    await page.keyboard.press("Control+,");
    await expect(dialog).toBeVisible();
    await expect(overlay(page).getByRole("searchbox")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await page.locator("pear-launcher").getByRole("button", { name: "Pear Desktop settings" }).click();
    await expect(dialog).toBeVisible();
    await overlay(page).getByRole("button", { name: "Close settings" }).click();
    await expect(dialog).toBeHidden();
  } finally {
    await app.close();
  }
});

test("toggles and configures plugins live, persisting to config.json", async () => {
  const app = await launchApp();
  try {
    const page = await mainWindow(app);
    await page.waitForFunction(() => window.__pearRuntime?.settings);
    await page.keyboard.press("Control+,");

    // Search narrows the list.
    await overlay(page).getByRole("searchbox").fill("blur");
    await expect(overlay(page).locator("[data-plugin]")).toHaveCount(1);

    expect(await enabled(page, "blur-nav-bar")).toBe(false);
    await pluginRow(page, "blur-nav-bar").getByRole("switch", { name: "Enable Blur navigation bar" }).click();
    await expect.poll(() => enabled(page, "blur-nav-bar")).toBe(true);
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.querySelector("#nav-bar-background")!).backdropFilter))
      .toBe("blur(8px)");

    await pluginRow(page, "blur-nav-bar").getByRole("button", { name: "Configure Blur navigation bar" }).click();
    const slider = pluginRow(page, "blur-nav-bar").getByLabel("Blur radius");
    await slider.focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await pluginConfig(page, "blur-nav-bar"))?.blur).toBe(12);
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.querySelector("#nav-bar-background")!).backdropFilter))
      .toBe("blur(12px)");

    await expect
      .poll(() => savedSettings(app.userData).plugins["blur-nav-bar"], { timeout: 5000 })
      .toMatchObject({ enabled: true, blur: 12 });

    // Keys typed in the overlay don't reach YTM (space would toggle playback).
    await overlay(page).getByRole("searchbox").fill("");
    await overlay(page).getByRole("searchbox").press("Space");
    await expect(overlay(page).getByRole("searchbox")).toHaveValue(" ");
  } finally {
    await app.close();
  }
});

test("records a global shortcut and registers it with the OS", async () => {
  const app = await launchApp({ plugins: { shortcuts: { enabled: true } } });
  try {
    const page = await mainWindow(app);
    await page.waitForFunction(() => window.__pearRuntime?.settings);
    await page.keyboard.press("Control+,");
    await pluginRow(page, "shortcuts").getByRole("button", { name: "Configure Global shortcuts" }).click();
    const recorder = pluginRow(page, "shortcuts").getByLabel("Play / pause");
    await recorder.click();
    await expect(recorder).toHaveText("Press keys…");
    await page.keyboard.press("Control+Alt+Shift+F9");
    await expect(recorder).toHaveText("Ctrl+Alt+Shift+F9");
    await expect.poll(async () => (await pluginConfig(page, "shortcuts"))?.playPause).toBe("Ctrl+Alt+Shift+F9");
    await expect
      .poll(() => app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered("Ctrl+Alt+Shift+F9")))
      .toBe(true);

    // Disabling the plugin releases it.
    await pluginRow(page, "shortcuts").getByRole("switch").click();
    await expect
      .poll(() => app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered("Ctrl+Alt+Shift+F9")))
      .toBe(false);
  } finally {
    await app.close();
  }
});

test("tray: close-to-tray hides instead of quitting", async () => {
  const app = await launchApp({ plugins: { tray: { enabled: true, config: { closeToTray: true } } } });
  try {
    await mainWindow(app);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ visible: w.isVisible() }))),
      )
      .toEqual([{ visible: false }]);
  } finally {
    await app.close();
  }
});
