// Core options that change the app itself: the application menu and its bar,
// the window title, the page tweaks under Appearance, themes, and the proxy.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ytmUrl } from "@pear/sdk/util";
import { expect, test } from "./fixtures.ts";
import { startConnectProxy, YTM_HOST } from "./helpers/network.ts";
import { waitForTrackPlaying } from "./helpers/playback.ts";
import { coreError, setCore } from "./helpers/plugins.ts";
import { sel } from "./helpers/player-bar.ts";
import { overlay } from "./helpers/settings.ts";
import { isAlwaysOnTop } from "./helpers/window.ts";
import { mainWindow, playTestTrack } from "./launch.ts";

/** YTM hides the like buttons in windows this narrow. */
const NARROW_WINDOW = 700;
/** Theme file edits are picked up within this. */
const THEME_RELOAD_MS = 10_000;

test("the application menu, and hiding its bar", async ({ launch }) => {
  const app = await launch({ core: { window: { hideMenu: true } } });
  const page = await mainWindow(app);
  const menu = () =>
    app.evaluate(({ BrowserWindow, Menu }) => {
      const window = BrowserWindow.getAllWindows()[0]!;
      const items = Menu.getApplicationMenu()?.items ?? [];
      return {
        labels: items.map((item) => item.label),
        submenus: Object.fromEntries(items.map((item) => [item.label, item.submenu?.items.filter((i) => i.visible && i.type !== "separator").map((i) => i.label) ?? []])),
        alwaysOnTop: Menu.getApplicationMenu()?.getMenuItemById("always-on-top")?.checked,
        autoHide: window.isMenuBarAutoHide(),
        visible: window.isMenuBarVisible(),
      };
    });

  const initial = await menu();
  if (process.platform === "darwin") {
    expect(initial.labels.slice(1)).toEqual(["Options", "View", "Navigation", "About"]);
  } else {
    expect(initial.labels).toEqual(["Options", "View", "Navigation", "About"]);
    expect(initial.submenus.Options).toEqual(["Settings…", "Always on top", "Toggle DevTools", "Edit config.json"]);
    // Hidden; Alt shows it.
    expect(initial).toMatchObject({ autoHide: true, visible: false });
    await setCore(page, "window", { hideMenu: false });
    await expect.poll(menu).toMatchObject({ autoHide: false, visible: true });
  }
  expect(initial.submenus.View).toEqual(["Reload", "Force Reload", "Zoom In", "Zoom Out", "Actual Size", "Toggle Full Screen"]);
  expect(initial.submenus.Navigation).toEqual(["Go back", "Go forward", "Copy current URL", "Restart App", "Exit"]);

  // "Always on top" is the core option: the window, the menu and the settings follow each other.
  const clickItem = (id: string) =>
    // Like a click: checkboxes toggle first.
    app.evaluate(({ Menu }, id) => Menu.getApplicationMenu()!.getMenuItemById(id)!.click(), id);
  await clickItem("always-on-top");
  await expect.poll(() => isAlwaysOnTop(app)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__pearRuntime!.plugins.core("window").config.alwaysOnTop)).toBe(true);
  await setCore(page, "window", { alwaysOnTop: false });
  await expect.poll(async () => (await menu()).alwaysOnTop).toBe(false);

  // Settings… opens the in-page dialog.
  await page.waitForFunction(() => window.__pearRuntime?.settings);
  await clickItem("settings");
  await expect(overlay(page).getByRole("dialog")).toBeVisible();
});

test("a custom window title stays put; without one the window follows the page", async ({ launch }) => {
  const app = await launch({ core: { appearance: { customWindowTitle: "My music" } } });
  const page = await mainWindow(app);
  const titles = () =>
    app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!;
      return { window: window.getTitle(), page: window.webContents.getTitle() };
    });
  await page.waitForFunction(() => document.title.length > 0);
  await page.goto(ytmUrl("/explore"));
  await page.waitForFunction(() => window.__pearRuntime);
  await expect.poll(async () => (await titles()).window).toBe("My music");

  await setCore(page, "appearance", { customWindowTitle: "" });
  await expect.poll(async () => {
    const { window, page } = await titles();
    return window === page && window !== "My music";
  }).toBe(true);
  await setCore(page, "appearance", { customWindowTitle: "Other title" });
  await expect.poll(async () => (await titles()).window).toBe("Other title");
});

test("appearance tweaks: Upgrade button, like buttons", async ({ launch }) => {
  test.setTimeout(150_000);
  const app = await launch({ core: { appearance: { removeUpgradeButton: true, likeButtons: "hide" } } });
  const page = await mainWindow(app);
  // Signed out there is no Upgrade entry: nothing else may disappear (pear-desktop's
  // `:last-child` fallback hid Library then).
  const entries = page.locator("#guide-renderer ytmusic-guide-entry-renderer");
  await expect(entries.last()).toBeVisible({ timeout: 30_000 });
  const count = await entries.count();
  for (let i = 0; i < count; i++) await expect(entries.nth(i)).toBeVisible();
  // An entry with the Upgrade entry's data (as signed-in, non-Premium users see it) is hidden.
  await page.evaluate(() => {
    const entry = [...document.querySelectorAll<HTMLElement & { data: Record<string, unknown> }>("#guide-renderer ytmusic-guide-entry-renderer")].at(-1)!;
    entry.data = {
      ...entry.data,
      navigationEndpoint: { browseEndpoint: { browseId: "SPunlimited" } },
      icon: { iconType: "\u0059\u004f\u0055\u0054\u0055\u0042\u0045_MUSIC_MONOCHROME" },
      formattedTitle: { runs: [{ text: "Upgrade" }] },
    };
  });
  await expect(entries.last()).toBeHidden();
  await setCore(page, "appearance", { removeUpgradeButton: false });
  await expect(entries.last()).toBeVisible();
  await expect(entries.last()).toContainText("Upgrade");

  await playTestTrack(page);
  await waitForTrackPlaying(page);
  const likes = page.locator(sel("player_bar.like_buttons"));
  await expect(likes).toBeHidden();
  await setCore(page, "appearance", { likeButtons: "" });
  await expect(likes).toBeVisible();

  // Swapped: dislike first.
  const order = () =>
    page.evaluate(
      ([like, dislike]) => {
        const left = (selector: string) => document.querySelector(selector)!.getBoundingClientRect().x;
        return left(like) < left(dislike) ? "like-first" : "dislike-first";
      },
      [sel("player_bar.like"), sel("player_bar.dislike")] as const,
    );
  expect(await order()).toBe("like-first");
  await setCore(page, "appearance", { swapLikeButtonsOrder: true });
  await expect.poll(order).toBe("dislike-first");

  // YTM hides the likes in narrow windows; "force" keeps them.
  await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]!.setSize(size, size), NARROW_WINDOW);
  await expect(likes).toBeHidden();
  await setCore(page, "appearance", { likeButtons: "force" });
  await expect(likes).toBeVisible();
  await expect.poll(order).toBe("dislike-first");
});

test("themes apply on top of \u0059\u006f\u0075\u0054\u0075\u0062\u0065 Music, follow file edits and list changes", async ({ launch, tempDir }) => {
  const dir = tempDir("pear-themes-");
  const theme = join(dir, "theme.css");
  const second = join(dir, "second.css");
  writeFileSync(theme, "ytmusic-nav-bar { outline: 3px solid rgb(1, 2, 3) !important; }");
  writeFileSync(second, "ytmusic-app-layout { outline: 2px solid rgb(4, 5, 6) !important; }");
  const app = await launch({ core: { appearance: { themes: [theme] } } });
  const page = await mainWindow(app);
  const outline = (selector: string) =>
    page.evaluate((selector) => {
      const element = document.querySelector(selector);
      return element ? getComputedStyle(element).outlineColor : "";
    }, selector);
  await page.waitForSelector("ytmusic-nav-bar");
  await expect.poll(() => outline("ytmusic-nav-bar")).toBe("rgb(1, 2, 3)");

  writeFileSync(theme, "ytmusic-nav-bar { outline: 3px solid rgb(7, 8, 9) !important; }");
  await expect.poll(() => outline("ytmusic-nav-bar"), { timeout: THEME_RELOAD_MS }).toBe("rgb(7, 8, 9)");

  await setCore(page, "appearance", { themes: [theme, second] });
  await expect.poll(() => outline("ytmusic-app-layout")).toBe("rgb(4, 5, 6)");
  await setCore(page, "appearance", { themes: [second] });
  await expect.poll(() => outline("ytmusic-nav-bar")).not.toBe("rgb(7, 8, 9)");

  // Missing files are reported in settings, and picked up once they exist.
  const later = join(dir, "later.css");
  await setCore(page, "appearance", { themes: [later] });
  await expect.poll(() => coreError(page, "appearance")).toContain("later.css");
  writeFileSync(later, "ytmusic-nav-bar { outline: 1px solid rgb(10, 11, 12) !important; }");
  await expect.poll(() => outline("ytmusic-nav-bar"), { timeout: THEME_RELOAD_MS }).toBe("rgb(10, 11, 12)");
  await expect.poll(() => coreError(page, "appearance")).toBe("");

  // A reload (no live events) gets the themes from the bootstrap.
  await page.reload();
  await page.waitForSelector("ytmusic-nav-bar");
  await expect.poll(() => outline("ytmusic-nav-bar")).toBe("rgb(10, 11, 12)");
});

test("podcast episodes show their host as the artist, or the listed participant", async ({ page }) => {
  test.setTimeout(120_000);
  await page.waitForSelector("ytmusic-app");
  // Any podcast episode will do; find one through YTM's own search.
  const videoId = await page.waitForFunction(async () => {
    const app = document.querySelector("ytmusic-app") as HTMLElement & { networkManager?: { fetch(path: string, body: unknown): Promise<unknown> } };
    if (!app.networkManager) return undefined;
    const found: string[] = [];
    const walk = (node: unknown) => {
      if (!node || typeof node !== "object") return;
      const n = node as { videoId?: string; watchEndpointMusicSupportedConfigs?: { watchEndpointMusicConfig?: { musicVideoType?: string } } };
      if (n.videoId && n.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType === "MUSIC_VIDEO_TYPE_PODCAST_EPISODE") found.push(n.videoId);
      for (const value of Object.values(node)) walk(value);
    };
    walk(await app.networkManager.fetch("/search", { query: "huberman lab podcast" }));
    return found[0];
  }, undefined, { timeout: 30_000 }).then((handle) => handle.jsonValue());
  await page.goto(ytmUrl(`/watch?v=${videoId}`));
  await page.waitForFunction((id) => window.__pearRuntime?.player.state.track?.videoId === id, videoId, { timeout: 30_000 });
  const artists = () =>
    page.evaluate(() => {
      const { player } = window.__pearRuntime!;
      const response = player.api!.getPlayerResponse();
      return {
        artist: player.state.track?.artist,
        mediaType: player.state.track?.mediaType,
        show: response.videoDetails?.author,
        host: response.microformat?.microformatDataRenderer?.pageOwnerDetails?.name,
      };
    });
  const before = await artists();
  expect(before.mediaType).toBe("podcast");
  expect(before.host).toBeTruthy();
  // pear-desktop's default: the channel owner.
  expect(before.artist).toBe(before.host);

  await setCore(page, "appearance", { usePodcastParticipantAsArtist: true });
  await expect.poll(async () => (await artists()).artist).toBe(before.show);
  await setCore(page, "appearance", { usePodcastParticipantAsArtist: false });
  await expect.poll(async () => (await artists()).artist).toBe(before.host);
});

test("advanced.proxy sends traffic through the proxy from the first request", async ({ launch, defer }) => {
  const proxy = await startConnectProxy();
  defer(proxy.close);
  await mainWindow(await launch({ core: { advanced: { proxy: proxy.url } } }));
  expect(proxy.tunnels[0]).toBe(`${YTM_HOST}:443`);
});
