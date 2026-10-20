// Interface tweaks: plugins that add to or restyle YTM's own UI.

import { expect, test } from "@playwright/test";
import { quit, screenshot, setConfig, setEnabled, skipAds } from "./interface-helpers.ts";
import { launchApp, mainWindow, playTestTrack } from "./launch.ts";

// Rick Astley, "Whenever You Need Somebody": an album page that works logged out.
const ALBUM_URL = "https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/playlist?list=OLAK5uy_nmDUsWOMoEcz0SsVqUwir0oxu-k1oUyXE";

test("clock and navigation buttons live in the top bar", async () => {
  const app = await launchApp({
    plugins: { clock: { enabled: true, config: { displaySeconds: true } }, navigation: { enabled: true } },
  });
  try {
    const page = await mainWindow(app);
    const clock = page.locator("#right-content .pear-clock");
    await expect(clock).toHaveText(/^\d{1,2}:\d{2}:\d{2}$/);
    const first = await clock.textContent();
    await expect.poll(() => clock.textContent(), { timeout: 3000 }).not.toBe(first);

    await setConfig(page, "clock", { displaySeconds: false, hour12: true });
    await expect(clock).toHaveText(/^\d{1,2}:\d{2}\s?[AP]M$/i);

    const back = page.locator("#left-content .pear-navigation button[aria-label='Go to previous page']");
    const forward = page.locator("#left-content .pear-navigation button[aria-label='Go to next page']");
    await expect(back).toBeVisible();
    await expect(forward).toBeDisabled();
    await page.locator("ytmusic-guide-entry-renderer", { hasText: "Explore" }).first().click();
    await expect(page).toHaveURL(/\/explore/);
    await expect(back).toBeEnabled();
    await back.click();
    await expect(page).not.toHaveURL(/\/explore/);
    await expect(forward).toBeEnabled();
    await forward.click();
    await expect(page).toHaveURL(/\/explore/);
    await screenshot(page, "nav-bar");

    await setEnabled(page, "clock", false);
    await setEnabled(page, "navigation", false);
    await expect(page.locator(".pear-clock, .pear-navigation")).toHaveCount(0);
  } finally {
    await quit(app);
  }
});

test("album colors, ambient glow and the video switch on the player page", async () => {
  test.setTimeout(180_000);
  const app = await launchApp({
    plugins: {
      "album-color-theme": { enabled: true },
      "ambient-mode": { enabled: true, config: { blur: 60 } },
      "video-toggle": { enabled: true },
    },
  });
  try {
    const page = await mainWindow(app);
    await playTestTrack(page);
    await skipAds(page);

    // The artwork's average color is mixed into YTM's palette.
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("pear-album-color"))).toBe(true);
    const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(await background()).not.toBe("rgb(3, 3, 3)");

    // The music video gets a glow canvas behind it that follows the video.
    const canvas = page.locator("#song-video .player-wrapper canvas.pear-ambient");
    await expect(canvas).toHaveCount(1);
    await expect(canvas).toHaveCSS("filter", "blur(60px)");
    await expect
      .poll(() =>
        canvas.evaluate((c: HTMLCanvasElement) => {
          const data = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
          return data.some((value, i) => i % 4 === 3 && value > 0);
        }),
      )
      .toBe(true);

    // Pear Desktop's song/video switch replaces YTM's and is remembered.
    const song = page.locator(".pear-video-toggle [role=radio]", { hasText: "Song" });
    await expect(song).toBeVisible();
    await expect(page.locator("#av-id")).toBeHidden();
    await screenshot(page, "player-video");
    await song.click();
    await expect(page.locator("#song-video")).toBeHidden();
    await expect(page.locator("#song-image")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.__pearRuntime!.plugins.state("video-toggle")?.config.hideVideo))
      .toBe(true);
    // In song mode the glow comes from the cover art instead.
    await expect(page.locator("#song-image img.pear-ambient")).toHaveCount(1);
    await expect(canvas).toHaveCount(0);
    await screenshot(page, "player-song");

    // Or hide the player altogether and give the queue the whole page.
    await setConfig(page, "video-toggle", { forceHide: true });
    await expect(page.locator("ytmusic-player-page #main-panel")).toBeHidden();
    const sidePanel = await page.locator("ytmusic-player-page #side-panel").boundingBox();
    expect(sidePanel!.width).toBeGreaterThan(700);
    await setEnabled(page, "video-toggle", false);
    await expect(page.locator("ytmusic-player-page #main-panel")).toBeVisible();
    await expect(page.locator(".pear-video-toggle")).toHaveCount(0);
    await setEnabled(page, "ambient-mode", false);
    await expect(page.locator(".pear-ambient")).toHaveCount(0);
    await setEnabled(page, "album-color-theme", false);
    await expect.poll(background).toBe("rgb(3, 3, 3)");
  } finally {
    await quit(app);
  }
});

test("album actions, unobtrusive playback and skipping disliked tracks", async () => {
  test.setTimeout(180_000);
  const app = await launchApp({
    plugins: {
      "album-actions": { enabled: true },
      "unobtrusive-player": { enabled: true },
      "skip-disliked-songs": { enabled: true },
    },
  });
  try {
    const page = await mainWindow(app);
    await page.goto(ALBUM_URL);

    // Like/dislike-all buttons under the album header; only the applicable ones show.
    const actions = page.locator(".pear-album-actions");
    await expect(actions).toBeVisible({ timeout: 30_000 });
    const likeAll = actions.locator("button[data-action=like]");
    await expect(likeAll).toBeVisible();
    await expect(likeAll).toHaveAttribute("aria-label", /^Like all \(\d+ of \d+\)$/);
    await expect(actions.locator("button[data-action=unlike]")).toBeHidden();
    await screenshot(page, "album-actions");

    // Liking needs an account: intercept the rows' like buttons and count what would be clicked.
    const rows = await page.evaluate(() => {
      const w = window as unknown as { __likes: number };
      w.__likes = 0;
      document.addEventListener(
        "click",
        (event) => {
          if ((event.target as Element).closest("#button-shape-like > button")) {
            w.__likes++;
            event.stopPropagation();
            event.preventDefault();
          }
        },
        true,
      );
      return document.querySelectorAll("#browse-page ytmusic-shelf-renderer #button-shape-like > button").length;
    });
    expect(rows).toBeGreaterThan(5);
    await likeAll.click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __likes: number }).__likes)).toBe(rows);

    // Playing the album from its header keeps the album in view (once any ad is over).
    await page.locator("ytmusic-responsive-header-renderer ytmusic-play-button-renderer").click();
    await page.waitForFunction(() => window.__pearRuntime!.player.state.track, undefined, { timeout: 30_000 });
    await skipAds(page);
    expect(await page.evaluate(() => document.documentElement.classList.contains("pear-unobtrusive-did-play"))).toBe(true);
    await expect(page.locator("ytmusic-app-layout")).not.toHaveAttribute("player-ui-state", "PLAYER_PAGE_OPEN");
    await expect(actions).toBeVisible();
    await screenshot(page, "unobtrusive");

    // Disliking the playing track (simulated: YTM reflects it on the player bar) skips it.
    const first = await page.evaluate(() => window.__pearRuntime!.player.state.track!.videoId);
    await page.evaluate(() =>
      document.querySelector("ytmusic-player-bar #like-button-renderer")!.setAttribute("like-status", "DISLIKE"),
    );
    await expect
      .poll(() => page.evaluate(() => window.__pearRuntime!.player.state.track?.videoId), { timeout: 30_000 })
      .not.toBe(first);
  } finally {
    await quit(app);
  }
});
