// Interface tweaks that change the window itself: title bar, transparency, picture in picture.

import { expect, test, type ElectronApplication } from "@playwright/test";
import { quit, screenshot, setConfig, setEnabled, skipAds } from "./interface-helpers.ts";
import { launchApp, mainWindow, playTestTrack } from "./launch.ts";

const windowInfo = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]!;
    return {
      bounds: window.getBounds(),
      maximized: window.isMaximized(),
      alwaysOnTop: window.isAlwaysOnTop(),
      background: window.getBackgroundColor(),
      zoom: window.webContents.getZoomLevel(),
    };
  });

test("in-app menu turns the top bar into a title bar with the app menu", async () => {
  const app = await launchApp({ plugins: { "in-app-menu": { enabled: true } } });
  try {
    const page = await mainWindow(app);
    const trigger = page.locator("pear-app-menu").getByRole("button", { name: "Application menu" });
    await expect(trigger).toBeVisible();
    expect(await page.evaluate(() => getComputedStyle(document.querySelector("ytmusic-nav-bar")!).getPropertyValue("app-region"))).toBe("drag");
    expect(
      await page.evaluate(() => getComputedStyle(document.querySelector("ytmusic-search-box")!).getPropertyValue("app-region")),
    ).toBe("no-drag");

    // The whole application menu, as pear-desktop drew it: its menus cascade from the trigger.
    await trigger.click();
    const menus = page.locator("pear-app-menu").getByRole("menu");
    const top = menus.first();
    await expect(top).toBeVisible();
    for (const label of ["Options", "View", "Navigation", "About"]) {
      await expect(top.getByRole("menuitem", { name: new RegExp(`^${label}`) })).toBeVisible();
    }
    await top.getByRole("menuitem", { name: /^View/ }).click();
    const view = menus.nth(1);
    for (const label of ["Reload", "Force Reload", "Zoom In", "Zoom Out", "Actual Size", "Toggle Full Screen"]) {
      await expect(view.getByRole("menuitem", { name: new RegExp(`^${label}`) })).toBeVisible();
    }
    await page.waitForTimeout(300);
    await screenshot(page, "in-app-menu");
    await view.getByRole("menuitem", { name: /^Zoom In/ }).click();
    await expect(top).toBeHidden();
    await expect.poll(async () => (await windowInfo(app)).zoom).toBe(0.5);
    await trigger.click();
    await top.getByRole("menuitem", { name: /^View/ }).click();
    await view.getByRole("menuitem", { name: /^Actual Size/ }).click();
    await expect.poll(async () => (await windowInfo(app)).zoom).toBe(0);
    // Items unreachable from the old fixed list.
    await trigger.click();
    await top.getByRole("menuitem", { name: /^Navigation/ }).click();
    for (const label of ["Go back", "Go forward", "Copy current URL", "Restart App", "Exit"]) {
      await expect(menus.nth(1).getByRole("menuitem", { name: new RegExp(`^${label}`) })).toBeVisible();
    }
    await menus.nth(1).getByRole("menuitem", { name: /^Copy current URL/ }).click();
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(page.url());
    // Checkboxes show their state and toggle.
    await trigger.click();
    await top.getByRole("menuitem", { name: /^Options/ }).click();
    const onTop = menus.nth(1).getByRole("menuitemcheckbox", { name: /^Always on top/ });
    await expect(onTop).toHaveAttribute("aria-checked", "false");
    await onTop.click();
    await expect.poll(async () => (await windowInfo(app)).alwaysOnTop).toBe(true);
    await trigger.click();
    await top.getByRole("menuitem", { name: /^Options/ }).click();
    await expect(onTop).toHaveAttribute("aria-checked", "true");
    await onTop.click();
    await expect.poll(async () => (await windowInfo(app)).alwaysOnTop).toBe(false);

    // Keyboard: F10 opens with focus on the first entry, arrows move and open submenus, Escape closes.
    await page.keyboard.press("F10");
    await expect(top).toBeVisible();
    await expect(top.getByRole("menuitem", { name: /^Options/ })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(top.getByRole("menuitem", { name: /^View/ })).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(menus.nth(1).getByRole("menuitem", { name: /^Reload/ })).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(top.getByRole("menuitem", { name: /^View/ })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(top).toBeHidden();

    // Settings opens Pear Desktop's overlay.
    await trigger.click();
    await top.getByRole("menuitem", { name: /^Options/ }).click();
    await menus.nth(1).getByRole("menuitem", { name: /^Settings/ }).click();
    await expect(page.locator("pear-settings").getByRole("dialog")).toBeVisible();
    await page.locator("pear-settings").getByRole("button", { name: "Close settings" }).click();

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
  } finally {
    await quit(app);
  }
});

test("transparent player makes the window see-through", async () => {
  const app = await launchApp({ plugins: { "transparent-player": { enabled: true, config: { opacity: 40 } } } });
  try {
    const page = await mainWindow(app);
    await page.waitForSelector("ytmusic-nav-bar");
    const body = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await expect.poll(body).toBe("rgba(17, 17, 17, 0.4)");
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
    // Electron reports a fully transparent background without its alpha.
    expect((await windowInfo(app)).background).toBe("#000000");
    await screenshot(page, "transparent");

    await setConfig(page, "transparent-player", { opacity: 70 });
    await expect.poll(body).toBe("rgba(17, 17, 17, 0.7)");

    await setEnabled(page, "transparent-player", false);
    await expect.poll(body).toBe("rgb(3, 3, 3)");
    expect((await windowInfo(app)).background).toBe("#030303");
  } finally {
    await quit(app);
  }
});

test("picture in picture shrinks the window and restores it", async () => {
  test.setTimeout(180_000);
  const app = await launchApp({ plugins: { "picture-in-picture": { enabled: true, config: { useNativePiP: false } } } });
  try {
    const page = await mainWindow(app);
    await playTestTrack(page);
    await skipAds(page);
    const before = await windowInfo(app);

    // From the track's menu…
    await page.locator("ytmusic-player-bar ytmusic-menu-renderer.menu yt-button-shape button").click();
    const item = page.locator("ytmusic-menu-popup-renderer .pear-pip-item");
    await expect(item).toBeVisible();
    await item.click();
    await expect.poll(async () => (await windowInfo(app)).bounds.width).toBe(450);
    const small = await windowInfo(app);
    expect(small.bounds.height).toBe(275);
    expect(small.alwaysOnTop).toBe(true);
    await expect(page.locator("html.pear-pip")).toHaveCount(1);
    await expect(page.locator("ytmusic-popup-container .pear-pip-item")).toBeHidden();
    // YTM's full-screen player fills the small window, not the screen.
    await expect(page.locator("ytmusic-player#player")).toHaveAttribute("player-ui-state", "FULLSCREEN");
    await page.waitForTimeout(500);
    expect((await windowInfo(app)).bounds.width).toBe(450);
    // pear-desktop's small-window styling: no track info or menu in the bar.
    for (const info of await page.locator("ytmusic-player-bar .content-info-wrapper, ytmusic-player-controls .content-info-wrapper").all()) {
      await expect(info).toBeHidden();
    }
    for (const menu of await page.locator("ytmusic-player-bar ytmusic-menu-renderer").all()) await expect(menu).toBeHidden();
    // "f" would leave YTM's full screen; in the small window it does nothing.
    await page.keyboard.press("f");
    await page.waitForTimeout(500);
    await expect(page.locator("ytmusic-player#player")).toHaveAttribute("player-ui-state", "FULLSCREEN");
    await screenshot(page, "pip");
    // Working in another window keeps the small one.
    await app.evaluate(({ BrowserWindow }) => {
      const other = new BrowserWindow({ width: 300, height: 200 });
      other.focus();
      setTimeout(() => other.destroy(), 1500);
    });
    await page.waitForTimeout(2500);
    expect((await windowInfo(app)).bounds.width).toBe(450);
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
    await expect.poll(async () => (await windowInfo(app)).bounds.width).toBe(450);
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
  } finally {
    await quit(app);
  }
});
