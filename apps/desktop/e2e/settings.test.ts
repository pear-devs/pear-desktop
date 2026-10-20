// The settings dialog (in-page overlay and standalone window) drives plugins
// and core options live and persists them to disk.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { launchApp, mainWindow } from "./launch.ts";

const overlay = (page: Page) => page.locator("pear-settings");
const pluginRow = (page: Page, id: string) => overlay(page).locator(`[data-plugin="${id}"]`);
const section = (page: Page, name: string) => overlay(page).getByRole("navigation").getByRole("button", { name }).click();
const enabled = (page: Page, id: string) =>
  page.evaluate((id) => window.__pearRuntime!.plugins.state(id)?.enabled, id);
const pluginConfig = (page: Page, id: string) =>
  page.evaluate((id) => window.__pearRuntime!.plugins.state(id)?.config, id);
/** config.json as saved so far ({} until the first debounced write). */
const savedSettings = (userData: string) => {
  try {
    return JSON.parse(readFileSync(join(userData, "config.json"), "utf8"));
  } catch {
    return {};
  }
};

test("opens from the shortcut and the sidebar entry, closes with Escape", async () => {
  const app = await launchApp();
  try {
    const page = await mainWindow(app);
    const dialog = overlay(page).getByRole("dialog");

    await page.waitForFunction(() => window.__pearRuntime?.settings);
    await page.keyboard.press("Control+,");
    await expect(dialog).toBeVisible();
    await expect(overlay(page).getByRole("searchbox")).toBeFocused();
    // Opens on General, like pear-desktop's settings.
    await expect(overlay(page).getByRole("navigation").getByRole("button", { name: "General" })).toHaveAttribute("aria-current", "page");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await page.locator("pear-settings-entry").first().getByRole("button", { name: "Pear Desktop settings" }).click();
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
    await overlay(page).getByRole("searchbox").fill("blur navigation");
    await expect(overlay(page).locator("[data-plugin]")).toHaveCount(1);

    expect(await enabled(page, "blur-nav-bar")).toBe(false);
    await pluginRow(page, "blur-nav-bar").getByRole("switch", { name: "Enable Blur Navigation Bar" }).click();
    await expect.poll(() => enabled(page, "blur-nav-bar")).toBe(true);
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.querySelector("#nav-bar-background")!).backdropFilter))
      .toBe("blur(8px)");

    await pluginRow(page, "blur-nav-bar").getByRole("button", { name: "Configure Blur Navigation Bar" }).click();
    const slider = pluginRow(page, "blur-nav-bar").getByLabel("Blur radius");
    await slider.fill("12");
    await expect.poll(async () => (await pluginConfig(page, "blur-nav-bar"))?.blur).toBe(12);
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.querySelector("#nav-bar-background")!).backdropFilter))
      .toBe("blur(12px)");

    await expect
      .poll(() => savedSettings(app.userData).plugins?.["blur-nav-bar"], { timeout: 5000 })
      .toMatchObject({ enabled: true, blur: 12 });

    // Keys typed in the overlay don't reach YTM (space would toggle playback).
    await overlay(page).getByRole("searchbox").fill("");
    await overlay(page).getByRole("searchbox").press("Space");
    await expect(overlay(page).getByRole("searchbox")).toHaveValue(" ");
  } finally {
    await app.close();
  }
});

test("the API server under Advanced starts and stops the server", async () => {
  const port = 30000 + Math.floor(Math.random() * 20000);
  const app = await launchApp({ core: { apiServer: { port } } });
  try {
    const page = await mainWindow(app);
    await page.waitForFunction(() => window.__pearRuntime?.settings);
    await page.keyboard.press("Control+,");
    await section(page, "Advanced");
    const enable = overlay(page).getByRole("switch", { name: "Enable the API server" });
    const status = overlay(page).locator("[data-status]");

    const docStatus = async () => (await fetch(`http://127.0.0.1:${port}/doc`).catch(() => null))?.status ?? "down";
    expect(await docStatus()).toBe("down");
    await enable.click();
    await expect.poll(docStatus).toBe(200);
    await expect(status).toContainText(`http://127.0.0.1:${port}`);
    await expect
      .poll(() => savedSettings(app.userData).plugins?.["api-server"], { timeout: 5000 })
      .toMatchObject({ enabled: true, port });
    await expect(overlay(page).getByLabel("Hostname")).toHaveValue("127.0.0.1");

    await enable.click();
    await expect.poll(docStatus).toBe("down");
    await expect(status).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test("core options apply live; restart-only ones offer a restart", async () => {
  const app = await launchApp();
  try {
    const page = await mainWindow(app);
    await page.waitForFunction(() => window.__pearRuntime?.settings);
    await page.keyboard.press("Control+,");
    const isOnTop = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isAlwaysOnTop());

    await section(page, "Window & Tray");
    expect(await isOnTop()).toBe(false);
    await overlay(page).getByRole("switch", { name: "Always on top" }).click();
    await expect.poll(isOnTop).toBe(true);
    // The tray plugin is configured where it belongs thematically.
    await expect(pluginRow(page, "tray")).toBeVisible();

    await section(page, "General");
    await overlay(page).getByLabel("Starting page").selectOption("Explore");
    await expect.poll(() => savedSettings(app.userData).options?.startingPage, { timeout: 5000 }).toBe("Explore");
    await expect(overlay(page).getByLabel("Starting page")).toHaveValue("Explore");

    await section(page, "Advanced");
    const banner = overlay(page).getByRole("status").filter({ hasText: "restart" });
    await expect(banner).toHaveCount(0);
    await overlay(page).getByRole("switch", { name: "Hardware acceleration" }).click();
    await expect(banner).toBeVisible();
    await expect(banner.getByRole("button", { name: "Restart now" })).toBeVisible();
    // Closing and reopening the dialog keeps the pending restart.
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+,");
    await expect(banner).toBeVisible();
    await banner.getByRole("button", { name: "Later" }).click();
    await expect(banner).toHaveCount(0);

    // Search spans core options and plugins.
    await overlay(page).getByRole("searchbox").fill("always on top");
    await expect(overlay(page).getByRole("switch", { name: "Always on top" })).toBeVisible();
    await expect(overlay(page).locator("[data-plugin]")).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test("opens on the starting page when the last page isn't reopened", async () => {
  const app = await launchApp({ core: { general: { resumeOnStart: false, startingPage: "Explore" } } });
  try {
    const page = await mainWindow(app);
    await expect.poll(() => new URL(page.url()).pathname).toBe("/explore");
  } finally {
    await app.close();
  }
});

test("the standalone settings window changes settings without the page", async () => {
  const app = await launchApp();
  try {
    const page = await mainWindow(app);
    const next = app.waitForEvent("window");
    // What `pear --settings` does in a running instance.
    await app.evaluate(({ app }) => app.emit("second-instance", {}, ["pear", "--settings"], ""));
    const standalone = await next;
    expect(standalone.url()).toBe("pear://settings/");
    const dialog = standalone.locator("pear-settings");
    await dialog.getByRole("navigation").getByRole("button", { name: "Plugins" }).click();
    await dialog.locator('[data-plugin="clock"]').getByRole("switch", { name: "Enable Clock" }).click();

    // The main window's page follows, and the change is saved.
    await expect.poll(() => enabled(page, "clock")).toBe(true);
    await expect.poll(() => savedSettings(app.userData).plugins?.clock?.enabled, { timeout: 5000 }).toBe(true);
    await expect(dialog.locator('[data-plugin="clock"]').getByRole("switch")).toHaveAttribute("aria-checked", "true");
    // It can't impersonate the page runtime.
    await expect(standalone.evaluate(() => window.__pear!.invoke("player:update", {} as never))).rejects.toThrow(/page runtime/);
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
    await section(page, "Plugins");
    await pluginRow(page, "shortcuts").getByRole("button", { name: "Configure Shortcuts (& MPRIS)" }).click();
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
    await pluginRow(page, "shortcuts").getByRole("switch", { name: "Enable Shortcuts (& MPRIS)" }).click();
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

test("an existing pear-desktop 3.x config.json is migrated in place", async () => {
  const app = await launchApp({
    config: {
      "window-size": { width: 900, height: 700 },
      "window-maximized": false,
      "window-position": { x: -1, y: -1 },
      url: "https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/watch?v=dQw4w9WgXcQ",
      options: { tray: false, alwaysOnTop: true, resumeOnStart: false, startingPage: "Explore", language: "el" },
      plugins: {
        clock: { enabled: true },
        "blur-nav-bar": { enabled: true, blur: 20 },
        "api-server": { enabled: false, authorizedClients: ["phone"] },
        "picture-in-picture": { "pip-position": [30, 40] },
      },
      __internal__: { migrations: { version: "3.12.0" } },
    },
  });
  try {
    const page = await mainWindow(app);
    await expect.poll(() => new URL(page.url()).pathname).toBe("/explore");
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isAlwaysOnTop())).toBe(true);
    expect(await enabled(page, "clock")).toBe(true);
    expect(await enabled(page, "tray")).toBe(false);
    expect((await pluginConfig(page, "blur-nav-bar"))?.blur).toBe(20);
    const file = savedSettings(app.userData);
    expect(file.__internal__.migrations.version).toBe("4.0.0");
    // Options this version doesn't use yet are kept.
    expect(file.options.language).toBe("el");
    // pear-desktop's defaults where the rewrite's differ: performance-improvement on,
    // the API server on every interface; and PiP's saved position in its own file.
    expect(await enabled(page, "performance-improvement")).toBe(true);
    expect(file.plugins["api-server"].hostname).toBe("0.0.0.0");
    expect(JSON.parse(readFileSync(join(app.userData, "picture-in-picture.json"), "utf8"))).toEqual({ x: 30, y: 40 });
  } finally {
    await app.close();
  }
});

test("pear-desktop's tray users keep close-to-tray", async () => {
  const app = await launchApp({ config: { options: { tray: true }, __internal__: { migrations: { version: "3.12.0" } } } });
  try {
    await mainWindow(app);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ visible: w.isVisible() }))))
      .toEqual([{ visible: false }]);
  } finally {
    await app.close();
  }
});

test("follows the chosen language, with English for untranslated texts", async () => {
  const de = JSON.parse(readFileSync(join(import.meta.dirname, "../../../src/i18n/resources/de.json"), "utf8"));
  const app = await launchApp({ core: { general: { language: "de" } } });
  try {
    const page = await mainWindow(app);
    await page.waitForFunction(() => window.__pearRuntime?.settings);
    // pear-desktop's translated plugin names.
    const name = await page.evaluate(() => window.__pearRuntime!.plugins.plugins.find((p) => p.id === "clock")!.name);
    expect(name).toBe(de.plugins.clock.name);
    await page.keyboard.press("Control+,");
    await overlay(page).getByRole("searchbox").fill(de.plugins.clock.name);
    await expect(pluginRow(page, "clock")).toContainText(de.plugins.clock.name);
    // Texts Weblate hasn't translated yet fall back to English.
    expect(await page.evaluate(() => window.__pearRuntime!.plugins.t("settings-ui.no-such-key", "fallback"))).toBe("fallback");
  } finally {
    await app.close();
  }
});
