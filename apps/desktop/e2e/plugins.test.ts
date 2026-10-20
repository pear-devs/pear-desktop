// Milestone 2: one plugin per layer, toggled and reconfigured live.

import { ytmUrl } from "@pear/sdk/util";
import { expect, test } from "./fixtures.ts";
import { pause, playerStatus } from "./helpers/playback.ts";
import { setConfig, setEnabled } from "./helpers/plugins.ts";
import { mainWindow, playTestTrack, TEST_TRACK } from "./launch.ts";

/** disable-autoplay: the track must stay paused at least this long. */
const STAYS_PAUSED_MS = 3000;

test("blur-nav-bar applies build-time CSS and reacts to config and disable live", async ({ launch }) => {
  const app = await launch({ plugins: { "blur-nav-bar": { enabled: true } } });
  const page = await mainWindow(app);
  const filter = () =>
    page.evaluate(() => {
      const el = document.querySelector("#nav-bar-background");
      return el ? getComputedStyle(el).backdropFilter : null;
    });
  await page.waitForSelector("#nav-bar-background", { state: "attached" });
  await expect.poll(filter).toBe("blur(8px)");

  await setConfig(page, "blur-nav-bar", { blur: 16 });
  await expect.poll(filter).toBe("blur(16px)");

  await setEnabled(page, "blur-nav-bar", false);
  await expect.poll(filter).toBe("none");

  // Invalid values are rejected by the schema and fall back to the default.
  await setEnabled(page, "blur-nav-bar", true);
  await setConfig(page, "blur-nav-bar", { blur: 999 });
  await expect.poll(filter).toBe("blur(8px)");
});

test("disable-autoplay keeps a freshly opened track paused", async ({ launch }) => {
  test.setTimeout(150_000);
  const app = await launch({ plugins: { "disable-autoplay": { enabled: true } } });
  const page = await mainWindow(app);
  await playTestTrack(page);
  // Logged-out sessions may get a pre-roll ad first. If it sits paused (the
  // plugin's early pause can catch it), play it like a user would; the track
  // itself must still not start afterwards.
  const settled = () =>
    page.evaluate(() => {
      const { player } = window.__pearRuntime!;
      const video = document.querySelector("video");
      if (player.state.ad && video?.paused) void video.play();
      return !player.state.ad && player.state.status === "paused" && !!video?.paused;
    });
  await expect.poll(settled, { timeout: 90_000 }).toBe(true);
  await page.waitForTimeout(STAYS_PAUSED_MS);
  expect(await settled()).toBe(true);
  expect(await page.evaluate(() => window.__pearRuntime!.player.state.positionSeconds)).toBeLessThan(2);
});

test("player facade publishes now-playing state to the host", async ({ page }) => {
  await playTestTrack(page);
  const track = await page.evaluate(() => window.__pearRuntime!.player.state.track);
  expect(track).toMatchObject({ videoId: TEST_TRACK, url: ytmUrl(`/watch?v=${TEST_TRACK}`) });
  expect(track!.title.length).toBeGreaterThan(0);
  expect(track!.artist.length).toBeGreaterThan(0);
  expect(track!.durationSeconds).toBeGreaterThan(60);

  await pause(page);
  await expect.poll(() => playerStatus(page)).toBe("paused");
});
