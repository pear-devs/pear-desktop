// The settings dialog (in-page overlay and standalone window) drives plugins
// and core options live and persists them to disk.

import { expect, test } from "./fixtures.ts";
import { randomPort } from "./helpers/network.ts";
import { playerStatus } from "./helpers/playback.ts";
import { pluginConfig, pluginEnabled } from "./helpers/plugins.ts";
import { openSection, openSettings, overlay, pluginRow, restartBanner, savedSettings, searchbox, sectionButton } from "./helpers/settings.ts";
import { isAlwaysOnTop } from "./helpers/window.ts";
import { mainWindow, playTestTrack } from "./launch.ts";
import type { Page } from "@playwright/test";

/** config.json is written a moment after a change (debounced). */
const SAVE_TIMEOUT_MS = 5000;

const navBarBlur = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.querySelector("#nav-bar-background")!).backdropFilter);

test("opens from the shortcut and the sidebar entry, closes with Escape", async ({ page }) => {
  const dialog = overlay(page).getByRole("dialog");

  await openSettings(page);
  await expect(dialog).toBeVisible();
  await expect(searchbox(page)).toBeFocused();
  // Opens on General, like pear-desktop's settings.
  await expect(sectionButton(page, "General")).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await page.locator("pear-settings-entry").first().getByRole("button", { name: "Pear Desktop settings" }).click();
  await expect(dialog).toBeVisible();
  await overlay(page).getByRole("button", { name: "Close settings" }).click();
  await expect(dialog).toBeHidden();
});

test("scrolling in the dialog, or over its scrim, leaves the page behind where it was", async ({ page }) => {
  const scrolled = () => page.evaluate(() => document.scrollingElement!.scrollTop);
  // The home page is long enough to scroll.
  await page.waitForFunction(() => document.scrollingElement!.scrollHeight > innerHeight + 500);
  expect(await scrolled()).toBe(0);

  await openSettings(page);
  const dialog = overlay(page).getByRole("dialog");
  await expect(dialog).toBeVisible();
  // Over the scrim, then far past the end of the dialog's body.
  await page.mouse.move(5, 300);
  await page.mouse.wheel(0, 1500);
  const box = (await dialog.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2);
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, 1500);
  await page.waitForTimeout(500);
  expect(await scrolled()).toBe(0);
});

test("another section opens at its top, not where the last one was scrolled to", async ({ page }) => {
  await openSettings(page);
  const body = overlay(page).locator(".body");
  const scrollTop = () => body.evaluate((element) => element.scrollTop);
  await openSection(page, "Plugins");
  await body.evaluate((element) => element.scrollTo(0, 2000));
  await expect.poll(scrollTop).toBeGreaterThan(0);
  await openSection(page, "Developer Tweaks");
  await expect.poll(scrollTop).toBe(0);
});

test("toggles and configures plugins live, persisting to config.json", async ({ app, page }) => {
  await openSettings(page);

  // Search narrows the list.
  await searchbox(page).fill("blur navigation");
  await expect(overlay(page).locator("[data-plugin]")).toHaveCount(1);

  expect(await pluginEnabled(page, "blur-nav-bar")).toBe(false);
  await pluginRow(page, "blur-nav-bar").getByRole("switch", { name: "Enable Blur Navigation Bar" }).click();
  await expect.poll(() => pluginEnabled(page, "blur-nav-bar")).toBe(true);
  await expect.poll(() => navBarBlur(page)).toBe("blur(8px)");

  await pluginRow(page, "blur-nav-bar").getByRole("button", { name: "Configure Blur Navigation Bar" }).click();
  await pluginRow(page, "blur-nav-bar").getByLabel("Blur radius").fill("12");
  await expect.poll(async () => (await pluginConfig(page, "blur-nav-bar"))?.blur).toBe(12);
  await expect.poll(() => navBarBlur(page)).toBe("blur(12px)");

  await expect
    .poll(() => savedSettings(app.userData).plugins?.["blur-nav-bar"], { timeout: SAVE_TIMEOUT_MS })
    .toMatchObject({ enabled: true, blur: 12 });
});

test("an edit is kept when the dialog closes right after it", async ({ page }) => {
  await openSettings(page);
  await searchbox(page).fill("blur navigation");
  await pluginRow(page, "blur-nav-bar").getByRole("button", { name: "Configure Blur Navigation Bar" }).click();
  // Closing within the debounce window must not drop the pending value.
  await pluginRow(page, "blur-nav-bar").getByLabel("Blur radius").fill("15");
  await page.keyboard.press("Escape");
  await expect(overlay(page).getByRole("dialog")).toBeHidden();
  await expect.poll(async () => (await pluginConfig(page, "blur-nav-bar"))?.blur).toBe(15);
});

test("keys typed in the overlay don't reach YTM", async ({ page }) => {
  await openSettings(page);
  // Space would toggle playback.
  await searchbox(page).press("Space");
  await expect(searchbox(page)).toHaveValue(" ");
});

test.describe(() => {
  const port = randomPort();
  test.use({ appOptions: { core: { apiServer: { port } } } });

  test("the API server under Advanced starts and stops the server", async ({ app, page }) => {
    await openSettings(page);
    await openSection(page, "Advanced");
    const enable = overlay(page).getByRole("switch", { name: "Enable the API server" });
    const status = overlay(page).locator("[data-status]");

    const docStatus = async () => (await fetch(`http://127.0.0.1:${port}/doc`).catch(() => null))?.status ?? "down";
    expect(await docStatus()).toBe("down");
    await enable.click();
    await expect.poll(docStatus).toBe(200);
    await expect(status).toContainText(`http://127.0.0.1:${port}`);
    await expect
      .poll(() => savedSettings(app.userData).plugins?.["api-server"], { timeout: SAVE_TIMEOUT_MS })
      .toMatchObject({ enabled: true, port });
    await expect(overlay(page).getByLabel("Hostname")).toHaveValue("127.0.0.1");

    await enable.click();
    await expect.poll(docStatus).toBe("down");
    await expect(status).toHaveCount(0);
  });
});

test("core options apply live, where they belong", async ({ app, page }) => {
  await openSettings(page);

  await openSection(page, "Window & Tray");
  expect(await isAlwaysOnTop(app)).toBe(false);
  await overlay(page).getByRole("switch", { name: "Always on top" }).click();
  await expect.poll(() => isAlwaysOnTop(app)).toBe(true);
  // The tray plugin is configured where it belongs thematically.
  await expect(pluginRow(page, "tray")).toBeVisible();

  await openSection(page, "General");
  await overlay(page).getByLabel("Starting page").selectOption("Explore");
  await expect.poll(() => savedSettings(app.userData).options?.startingPage, { timeout: SAVE_TIMEOUT_MS }).toBe("Explore");
  await expect(overlay(page).getByLabel("Starting page")).toHaveValue("Explore");

  // Search spans core options and plugins.
  await searchbox(page).fill("always on top");
  await expect(overlay(page).getByRole("switch", { name: "Always on top" })).toBeVisible();
  await expect(overlay(page).locator("[data-plugin]")).toHaveCount(0);
});

test("restart-only core options offer a restart, kept while the dialog is closed", async ({ page }) => {
  await openSettings(page);
  await openSection(page, "Advanced");
  const banner = restartBanner(page);
  await expect(banner).toHaveCount(0);
  await overlay(page).getByRole("switch", { name: "Hardware acceleration" }).click();
  await expect(banner).toBeVisible();
  await expect(banner.getByRole("button", { name: "Restart now" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+,");
  await expect(banner).toBeVisible();
  await banner.getByRole("button", { name: "Later" }).click();
  await expect(banner).toHaveCount(0);
});

test.describe(() => {
  test.use({ appOptions: { core: { general: { resumeOnStart: false, startingPage: "Explore" } } } });

  test("opens on the starting page when the last page isn't reopened", async ({ page }) => {
    await expect.poll(() => new URL(page.url()).pathname).toBe("/explore");
  });
});

test("the standalone settings window changes settings without the page", async ({ app, page }) => {
  const next = app.waitForEvent("window");
  // What `pear --settings` does in a running instance.
  await app.evaluate(({ app }) => app.emit("second-instance", {}, ["pear", "--settings"], ""));
  const standalone = await next;
  expect(standalone.url()).toBe("pear://settings/");
  const dialog = standalone.locator("pear-settings");
  await dialog.getByRole("navigation").getByRole("button", { name: "Plugins" }).click();
  await dialog.locator('[data-plugin="clock"]').getByRole("switch", { name: "Enable Clock" }).click();

  // The main window's page follows, and the change is saved.
  await expect.poll(() => pluginEnabled(page, "clock")).toBe(true);
  await expect.poll(() => savedSettings(app.userData).plugins?.clock?.enabled, { timeout: SAVE_TIMEOUT_MS }).toBe(true);
  await expect(dialog.locator('[data-plugin="clock"]').getByRole("switch")).toHaveAttribute("aria-checked", "true");
  // It can't impersonate the page runtime.
  await expect(standalone.evaluate(() => window.__pear!.invoke("player:update", {} as never))).rejects.toThrow(/page runtime/);
});

test.describe("shortcuts", () => {
  const SHORTCUT = "Ctrl+Alt+Shift+F9";
  const isRegistered = (app: import("./launch.ts").App, accelerator: string) =>
    app.evaluate(({ globalShortcut }, accelerator) => globalShortcut.isRegistered(accelerator), accelerator);

  test.use({ appOptions: { plugins: { shortcuts: { enabled: true } } } });

  test("records a global shortcut and registers it with the OS", async ({ app, page }) => {
    await openSettings(page);
    await openSection(page, "Plugins");
    await pluginRow(page, "shortcuts").getByRole("button", { name: "Configure Shortcuts (& MPRIS)" }).click();
    // The global one (the in-window ones follow under their own heading).
    const recorder = pluginRow(page, "shortcuts").getByLabel("Play / pause").first();
    await recorder.click();
    await expect(recorder).toHaveText("Press keys…");
    await page.keyboard.press("Control+Alt+Shift+F9");
    await expect(recorder).toHaveText(SHORTCUT);
    await expect.poll(async () => (await pluginConfig(page, "shortcuts"))?.playPause).toBe(SHORTCUT);
    await expect.poll(() => isRegistered(app, SHORTCUT)).toBe(true);

    // Disabling the plugin releases it.
    await pluginRow(page, "shortcuts").getByRole("switch", { name: "Enable Shortcuts (& MPRIS)" }).click();
    await expect.poll(() => isRegistered(app, SHORTCUT)).toBe(false);
  });

  test("in-window shortcuts and media keys, as pear-desktop's shortcuts plugin", async ({ launch }) => {
    test.setTimeout(150_000);
    const app = await launch({ plugins: { shortcuts: { enabled: true, config: { localPlayPause: "Ctrl+Alt+K", overrideMediaKeys: true } } } });
    const page = await mainWindow(app);
    await playTestTrack(page);
    await page.waitForFunction(() => window.__pearRuntime!.player.state.status === "playing", undefined, { timeout: 60_000 });
    const status = () => playerStatus(page);
    // Only while the window has focus, before the page sees the key. Real key input goes
    // through Electron's input pipeline (Playwright's would skip before-input-event).
    const press = () =>
      app.evaluate(({ BrowserWindow }) => {
        const contents = BrowserWindow.getAllWindows()[0]!.webContents;
        contents.sendInputEvent({ type: "keyDown", keyCode: "K", modifiers: ["control", "alt"] });
        contents.sendInputEvent({ type: "keyUp", keyCode: "K", modifiers: ["control", "alt"] });
      });
    await press();
    await expect.poll(status).toBe("paused");
    await press();
    await expect.poll(status, { timeout: 30_000 }).toMatch(/playing|buffering/);
    // The media keys are taken globally.
    for (const key of ["MediaPlayPause", "MediaNextTrack", "MediaPreviousTrack"]) expect(await isRegistered(app, key)).toBe(true);
  });
});
