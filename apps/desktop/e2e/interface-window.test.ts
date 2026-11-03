// Interface tweaks that change the window itself: title bar, transparency, picture in picture.

import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { waitForTrackPlaying } from "./helpers/playback.ts";
import { setConfig, setEnabled } from "./helpers/plugins.ts";
import { overlay } from "./helpers/settings.ts";
import { screenshot, windowInfo } from "./helpers/window.ts";
import { mainWindow, NO_WINDOW_MANAGER, playTestTrack } from "./launch.ts";
import { inBar, sel } from "./helpers/player-bar.ts";

/** picture-in-picture's small window. */
const PIP_SIZE = { width: 450, height: 275 };
/** Long enough for YTM (or a stray resize) to undo a change. */
const SETTLE_MS = 500;

/** The in-app menu's menus: [0] the top one, [1] the open submenu. */
const appMenus = (page: Page) => page.locator("pear-app-menu").getByRole("menu");
const menuItem = (menu: Locator, label: string) => menu.getByRole("menuitem", { name: new RegExp(`^${label}`) });

/** Opens the in-app menu, then its `label` submenu; returns the submenu. */
async function openSubmenu(page: Page, trigger: Locator, label: string) {
  await trigger.click();
  await menuItem(appMenus(page).first(), label).click();
  return appMenus(page).nth(1);
}

async function expectMenuItems(menu: Locator, labels: string[]) {
  for (const label of labels) await expect(menuItem(menu, label)).toBeVisible();
}

test.describe("in-app menu", () => {
  test.use({ appOptions: { plugins: { "in-app-menu": { enabled: true } } } });

  /** The menu button, once the in-app menu is up. */
  const menuTrigger = async (page: Page) => {
    const trigger = page.locator("pear-app-menu").getByRole("button", { name: "Application menu" });
    await expect(trigger).toBeVisible();
    return trigger;
  };

  test("turns the top bar into a title bar with the whole app menu", async ({ app, page }) => {
    const trigger = await menuTrigger(page);
    expect(await page.evaluate(() => getComputedStyle(document.querySelector("ytmusic-nav-bar")!).getPropertyValue("app-region"))).toBe("drag");
    expect(
      await page.evaluate(() => getComputedStyle(document.querySelector("ytmusic-search-box")!).getPropertyValue("app-region")),
    ).toBe("no-drag");

    // The whole application menu, as pear-desktop drew it: its menus cascade from the trigger.
    await trigger.click();
    const menus = appMenus(page);
    const top = menus.first();
    await expect(top).toBeVisible();
    await expectMenuItems(top, ["Options", "View", "Navigation", "About"]);
    await menuItem(top, "View").click();
    const view = menus.nth(1);
    await expectMenuItems(view, ["Reload", "Force Reload", "Zoom In", "Zoom Out", "Actual Size", "Toggle Full Screen"]);
    await page.waitForTimeout(300);
    await screenshot(app, "in-app-menu");
    await menuItem(view, "Zoom In").click();
    await expect(top).toBeHidden();
    await expect.poll(async () => (await windowInfo(app)).zoom).toBe(0.5);
    await menuItem(await openSubmenu(page, trigger, "View"), "Actual Size").click();
    await expect.poll(async () => (await windowInfo(app)).zoom).toBe(0);
    // Items unreachable from the old fixed list.
    const navigation = await openSubmenu(page, trigger, "Navigation");
    await expectMenuItems(navigation, ["Go back", "Go forward", "Copy current URL", "Restart App", "Exit"]);
    await menuItem(navigation, "Copy current URL").click();
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(page.url());
    // Checkboxes show their state and toggle.
    const onTop = (await openSubmenu(page, trigger, "Options")).getByRole("menuitemcheckbox", { name: /^Always on top/ });
    await expect(onTop).toHaveAttribute("aria-checked", "false");
    await onTop.click();
    await expect.poll(async () => (await windowInfo(app)).alwaysOnTop).toBe(true);
    await openSubmenu(page, trigger, "Options");
    await expect(onTop).toHaveAttribute("aria-checked", "true");
    await onTop.click();
    await expect.poll(async () => (await windowInfo(app)).alwaysOnTop).toBe(false);
  });

  test("works with the keyboard", async ({ page }) => {
    const menus = appMenus(page);
    const top = menus.first();
    await menuTrigger(page);
    // F10 opens with focus on the first entry, arrows move and open submenus, Escape closes.
    await page.keyboard.press("F10");
    await expect(top).toBeVisible();
    await expect(menuItem(top, "Options")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menuItem(top, "View")).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(menuItem(menus.nth(1), "Reload")).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(menuItem(top, "View")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(top).toBeHidden();
  });

  test.describe("with a window manager", () => {
    // Maximizing takes one.
    test.skip(!!NO_WINDOW_MANAGER, NO_WINDOW_MANAGER);

    test("opens the settings, has window controls, and goes away when disabled", async ({ app, page }) => {
      const trigger = await menuTrigger(page);
      // Settings opens Pear Desktop's overlay.
      await menuItem(await openSubmenu(page, trigger, "Options"), "Settings").click();
      await expect(overlay(page).getByRole("dialog")).toBeVisible();
      await overlay(page).getByRole("button", { name: "Close settings" }).click();

      if (process.platform === "linux") {
        const controls = page.locator("pear-window-controls");
        await expect(controls.getByRole("button", { name: "Close" })).toBeVisible();
        await controls.getByRole("button", { name: "Maximize" }).click();
        await expect.poll(async () => (await windowInfo(app)).maximized).toBe(true);
        await expect(controls.getByRole("button", { name: "Restore" })).toBeVisible();
        await controls.getByRole("button", { name: "Restore" }).click();
        await expect.poll(async () => (await windowInfo(app)).maximized).toBe(false);

        await setConfig(page, "in-app-menu", { windowControls: false });
        await expect(controls).toHaveCount(0);
      }

      await setEnabled(page, "in-app-menu", false);
      await expect(page.locator("pear-app-menu, pear-window-controls")).toHaveCount(0);
      expect(await page.evaluate(() => getComputedStyle(document.querySelector("ytmusic-nav-bar")!).getPropertyValue("app-region"))).not.toBe("drag");
    });
  });
});

test("transparent player makes the window see-through", async ({ launch }) => {
  const app = await launch({ plugins: { "transparent-player": { enabled: true, config: { opacity: 40 } } } });
  const page = await mainWindow(app);
  await page.waitForSelector("ytmusic-nav-bar");
  const body = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await expect.poll(body).toBe("rgba(17, 17, 17, 0.4)");
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
  // Electron reports a fully transparent background without its alpha.
  expect((await windowInfo(app)).background).toBe("#000000");
  await screenshot(app, "transparent");

  await setConfig(page, "transparent-player", { opacity: 70 });
  await expect.poll(body).toBe("rgba(17, 17, 17, 0.7)");

  await setEnabled(page, "transparent-player", false);
  await expect.poll(body).toBe("rgb(3, 3, 3)");
  expect((await windowInfo(app)).background).toBe("#030303");
});

test("leaving picture in picture keeps the core always-on-top option", async ({ launch }) => {
  const app = await launch({
    core: { window: { alwaysOnTop: true } },
    plugins: { "picture-in-picture": { enabled: true, config: { useNativePiP: false } } },
  });
  const page = await mainWindow(app);
  await playTestTrack(page);
  await waitForTrackPlaying(page);
  expect((await windowInfo(app)).alwaysOnTop).toBe(true);
  const before = await windowInfo(app);

  await page.locator("body").click({ position: { x: 5, y: 400 } });
  await page.keyboard.press("p");
  await expect.poll(async () => (await windowInfo(app)).bounds.width).toBe(PIP_SIZE.width);
  await page.keyboard.press("p");
  await expect.poll(async () => (await windowInfo(app)).bounds.width).toBe(before.bounds.width);
  expect((await windowInfo(app)).alwaysOnTop).toBe(true);
});

test("picture in picture shrinks the window and restores it", async ({ launch }) => {
  test.setTimeout(180_000);
  const app = await launch({ plugins: { "picture-in-picture": { enabled: true, config: { useNativePiP: false } } } });
  const page = await mainWindow(app);
  await playTestTrack(page);
  await waitForTrackPlaying(page);
  const before = await windowInfo(app);

  // From the track's menu…
  await page.locator(sel("player_bar.menu_button")).click();
  const item = page.locator("ytmusic-menu-popup-renderer .pear-pip-item");
  await expect(item).toBeVisible();
  await item.click();
  await expect.poll(async () => (await windowInfo(app)).bounds.width).toBe(PIP_SIZE.width);
  const small = await windowInfo(app);
  expect(small.bounds.height).toBe(PIP_SIZE.height);
  expect(small.alwaysOnTop).toBe(true);
  await expect(page.locator("html.pear-pip")).toHaveCount(1);
  await expect(page.locator("ytmusic-popup-container .pear-pip-item")).toBeHidden();
  // YTM's full-screen player fills the small window, not the screen.
  await expect(page.locator("ytmusic-player#player")).toHaveAttribute("player-ui-state", "FULLSCREEN");
  await page.waitForTimeout(SETTLE_MS);
  expect((await windowInfo(app)).bounds.width).toBe(PIP_SIZE.width);
  // pear-desktop's small-window styling: no track info or menu in the bar.
  for (const info of await page.locator(`${inBar(".content-info-wrapper")}, ytmusic-player-controls .content-info-wrapper`).all()) {
    await expect(info).toBeHidden();
  }
  for (const menu of await page.locator(inBar("ytmusic-menu-renderer")).all()) await expect(menu).toBeHidden();
  // "f" would leave YTM's full screen; in the small window it does nothing.
  await page.keyboard.press("f");
  await page.waitForTimeout(SETTLE_MS);
  await expect(page.locator("ytmusic-player#player")).toHaveAttribute("player-ui-state", "FULLSCREEN");
  await screenshot(app, "pip");
  // Working in another window keeps the small one.
  await app.evaluate(({ BrowserWindow }) => {
    const other = new BrowserWindow({ width: 300, height: 200 });
    other.focus();
    setTimeout(() => other.destroy(), 1500);
  });
  await page.waitForTimeout(2500);
  expect((await windowInfo(app)).bounds.width).toBe(PIP_SIZE.width);
  await expect(page.locator("ytmusic-player#player")).toHaveAttribute("player-ui-state", "FULLSCREEN");

  // …and Escape brings everything back.
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await windowInfo(app)).bounds.width).toBe(before.bounds.width);
  expect((await windowInfo(app)).alwaysOnTop).toBe(false);
  await expect(page.locator("html.pear-pip")).toHaveCount(0);
  await expect(page.locator("ytmusic-player#player")).not.toHaveAttribute("player-ui-state", "FULLSCREEN");
  await page.waitForTimeout(1500);
  expect((await windowInfo(app)).bounds.width).toBe(before.bounds.width);

  // The hotkey toggles too.
  await page.locator("body").click({ position: { x: 5, y: 400 } });
  await page.keyboard.press("p");
  await expect.poll(async () => (await windowInfo(app)).bounds.width).toBe(PIP_SIZE.width);
  await setEnabled(page, "picture-in-picture", false);
  await expect.poll(async () => (await windowInfo(app)).bounds.width).toBe(before.bounds.width);
  await expect(page.locator("html.pear-pip")).toHaveCount(0);

  // The browser's own picture-in-picture pops out just the video.
  await setConfig(page, "picture-in-picture", { useNativePiP: true });
  await setEnabled(page, "picture-in-picture", true);
  await page.locator("body").click({ position: { x: 5, y: 400 } });
  await page.keyboard.press("p");
  await expect.poll(() => page.evaluate(() => document.pictureInPictureElement?.tagName)).toBe("VIDEO");
  expect((await windowInfo(app)).bounds.width).toBe(before.bounds.width);
  await page.keyboard.press("p");
  await expect.poll(() => page.evaluate(() => document.pictureInPictureElement)).toBeNull();
});

test.describe("with a window manager", () => {
  // Minimizing takes one.
  test.skip(!!NO_WINDOW_MANAGER, NO_WINDOW_MANAGER);

  test("the page knows when the window is off screen", async ({ app, page }) => {
    const windowVisible = () => page.evaluate(() => window.__pearRuntime!.plugins.windowVisible);
    const mainWindowDo = (action: "minimize" | "restore" | "hide" | "show") =>
      app.evaluate(({ BrowserWindow }, action) => BrowserWindow.getAllWindows()[0]![action](), action);
    // Shown once the page is ready to paint.
    await expect.poll(windowVisible).toBe(true);
    await mainWindowDo("minimize");
    await expect.poll(windowVisible).toBe(false);
    await mainWindowDo("restore");
    await expect.poll(windowVisible).toBe(true);
    await mainWindowDo("hide");
    await expect.poll(windowVisible).toBe(false);
    await mainWindowDo("show");
    await expect.poll(windowVisible).toBe(true);
  });
});
