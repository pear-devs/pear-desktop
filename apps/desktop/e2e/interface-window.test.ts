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

/** The in-app menu's title bar (pear-desktop's: the top-level menus side by side above YTM). */
const titleBar = (page: Page) => page.locator("pear-title-bar");
/** The bar's top-level menus; hidden while collapsed. */
const menuBar = (page: Page) => titleBar(page).getByRole("menubar");
/** The open panels: [0] the open top-level menu's, [1] its open submenu. */
const appMenus = (page: Page) => titleBar(page).getByRole("menu");
const menuItem = (menu: Locator, label: string) => menu.getByRole("menuitem", { name: new RegExp(`^${label}`) });
/** The button that shows or hides the top-level menus. */
const collapseToggle = (page: Page) => titleBar(page).getByRole("button", { name: "Application menu" });

/** Opens the `label` top-level menu from the bar; returns its panel. */
async function openMenu(page: Page, label: string) {
  await menuItem(menuBar(page), label).click();
  const menu = appMenus(page).first();
  await expect(menu).toBeVisible();
  return menu;
}

async function expectMenuItems(menu: Locator, labels: string[]) {
  for (const label of labels) await expect(menuItem(menu, label)).toBeVisible();
}

/** `app-region` of the element `pick` finds (in the page, or in the title bar's shadow root). */
const appRegion = (page: Page, pick: string) =>
  page.evaluate(
    (pick) => {
      const bar = document.querySelector("pear-title-bar");
      const element = pick === "bar" ? bar : (bar?.shadowRoot?.querySelector(pick) ?? document.querySelector(pick));
      return getComputedStyle(element!).getPropertyValue("app-region");
    },
    pick,
  );

test.describe("in-app menu", () => {
  test.use({ appOptions: { plugins: { "in-app-menu": { enabled: true } } } });

  test("adds a title bar with the whole app menu", async ({ app, page }) => {
    // pear-desktop's 32px bar above YTM, which moves the window; the menus start expanded.
    await expect(menuBar(page)).toBeVisible();
    await expect(collapseToggle(page)).toHaveAttribute("aria-expanded", "true");
    expect((await titleBar(page).boundingBox())?.height).toBe(32);
    expect(await appRegion(page, "bar")).toBe("drag");
    expect(await appRegion(page, ".menu-button")).toBe("no-drag");
    expect(await appRegion(page, "ytmusic-nav-bar")).not.toBe("drag");
    expectMenuItemsInOrder(await menuBar(page).getByRole("menuitem").allTextContents());

    // A click on a top-level menu opens its panel; a second one closes it.
    const view = await openMenu(page, "View");
    await expectMenuItems(view, ["Reload", "Force Reload", "Zoom In", "Zoom Out", "Actual Size", "Toggle Full Screen"]);
    await expect(menuItem(menuBar(page), "View")).toHaveAttribute("aria-expanded", "true");
    await page.waitForTimeout(300);
    await screenshot(app, "in-app-menu");
    await menuItem(menuBar(page), "View").click();
    await expect(view).toBeHidden();

    // A command closes the menu.
    await menuItem(await openMenu(page, "View"), "Zoom In").click();
    await expect(appMenus(page)).toHaveCount(0);
    await expect.poll(async () => (await windowInfo(app)).zoom).toBe(0.5);
    await menuItem(await openMenu(page, "View"), "Actual Size").click();
    await expect.poll(async () => (await windowInfo(app)).zoom).toBe(0);
    // Items unreachable from the old fixed list.
    const navigation = await openMenu(page, "Navigation");
    await expectMenuItems(navigation, ["Go back", "Go forward", "Copy current URL", "Restart App", "Exit"]);
    await menuItem(navigation, "Copy current URL").click();
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(page.url());
    // Checkboxes show their state and toggle in place: the menu stays open, as in pear-desktop.
    const options = await openMenu(page, "Options");
    const onTop = options.getByRole("menuitemcheckbox", { name: /^Always on top/ });
    await expect(onTop).toHaveAttribute("aria-checked", "false");
    await onTop.click();
    await expect.poll(async () => (await windowInfo(app)).alwaysOnTop).toBe(true);
    await expect(options).toBeVisible();
    await expect(onTop).toHaveAttribute("aria-checked", "true");
    await onTop.click();
    await expect.poll(async () => (await windowInfo(app)).alwaysOnTop).toBe(false);
    await expect(onTop).toHaveAttribute("aria-checked", "false");
    await page.keyboard.press("Escape");
    await expect(options).toBeHidden();

    // The button collapses and expands the top-level menus.
    await collapseToggle(page).click();
    await expect(menuBar(page)).toBeHidden();
    await expect(collapseToggle(page)).toHaveAttribute("aria-expanded", "false");
    await collapseToggle(page).click();
    await expect(menuItem(menuBar(page), "Options")).toBeVisible();
  });

  test("works with the keyboard", async ({ page }) => {
    const menus = appMenus(page);
    await expect(menuBar(page)).toBeVisible();
    // The backtick collapses and expands the menus…
    await page.keyboard.press("`");
    await expect(menuBar(page)).toBeHidden();
    await page.keyboard.press("`");
    await expect(menuItem(menuBar(page), "Options")).toBeVisible();
    // …but not while typing: the search box gets the character.
    const search = page.locator("ytmusic-search-box input");
    await search.click();
    await page.keyboard.press("`");
    await expect(search).toHaveValue("`");
    await expect(menuBar(page)).toBeVisible();
    await search.fill("");
    await page.keyboard.press("Escape");

    // Down opens a top-level menu with focus on its first entry, arrows move within it and
    // across the bar's menus, Escape closes and goes back to the bar.
    const options = menuItem(menuBar(page), "Options");
    await options.focus();
    await page.keyboard.press("ArrowDown");
    await expect(menus.first()).toBeVisible();
    await expect(menuItem(menus.first(), "Settings")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menus.first().getByRole("menuitemcheckbox", { name: /^Single Instance Lock/ })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menus.first().getByRole("menuitemcheckbox", { name: /^Always on top/ })).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(menuItem(menus.first(), "Reload")).toBeFocused();
    await expect(menuItem(menuBar(page), "View")).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("ArrowLeft");
    await expect(menuItem(menus.first(), "Settings")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menus).toHaveCount(0);
    await expect(options).toBeFocused();
  });

  test("starts collapsed when the menu bar is hidden", async ({ launch }) => {
    // macOS has no hideMenu option.
    test.skip(process.platform === "darwin", "no hideMenu option on macOS");
    const app = await launch({ plugins: { "in-app-menu": { enabled: true } }, core: { window: { hideMenu: true } } });
    const page = await mainWindow(app);
    await expect(collapseToggle(page)).toHaveAttribute("aria-expanded", "false");
    await expect(menuBar(page)).toBeHidden();
    await collapseToggle(page).click();
    await expectMenuItems(menuBar(page), ["Options", "View", "Navigation", "About"]);
  });

  test.describe("with a window manager", () => {
    // Maximizing takes one.
    test.skip(!!NO_WINDOW_MANAGER, NO_WINDOW_MANAGER);

    test("opens the settings, has window controls, and goes away when disabled", async ({ app, page }) => {
      // Settings opens Pear Desktop's overlay.
      await menuItem(await openMenu(page, "Options"), "Settings").click();
      await expect(overlay(page).getByRole("dialog")).toBeVisible();
      await overlay(page).getByRole("button", { name: "Close settings" }).click();

      if (process.platform === "linux") {
        const control = (name: string) => titleBar(page).getByRole("button", { name, exact: true });
        await expect(control("Close")).toBeVisible();
        await control("Maximize").click();
        await expect.poll(async () => (await windowInfo(app)).maximized).toBe(true);
        await expect(control("Restore")).toBeVisible();
        await control("Restore").click();
        await expect.poll(async () => (await windowInfo(app)).maximized).toBe(false);

        await setConfig(page, "in-app-menu", { windowControls: false });
        await expect(control("Minimize")).toHaveCount(0);
        await expect(menuBar(page)).toBeVisible();
      }

      await setEnabled(page, "in-app-menu", false);
      await expect(titleBar(page)).toHaveCount(0);
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--menu-bar-height"))).toBe("");
    });
  });
});

/** The bar's menus, in the application menu's order (macOS adds the app's own menu first). */
function expectMenuItemsInOrder(labels: string[]) {
  const expected = ["Options", "View", "Navigation", "About"];
  expect(process.platform === "darwin" ? labels.slice(1) : labels).toEqual(expected);
}

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
