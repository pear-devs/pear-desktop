// performance-improvement patches the page's timers for good, so it only runs
// when enabled at page load; toggling it asks for a restart instead.

import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { waitForTrackPlaying } from "./helpers/playback.ts";
import { pluginEnabled, setEnabled } from "./helpers/plugins.ts";
import { openSettings, pluginRow, restartBanner, searchbox } from "./helpers/settings.ts";
import { mainWindow, playTestTrack } from "./launch.ts";

/** Plugin patches settle within this after the page loads. */
const SETTLE_MS = 2000;

/** rm3 keeps the original createElement; cpu-tamer replaces the native setTimeout. */
const patched = (page: Page) =>
  page.evaluate(() => ({
    rm3: typeof Reflect.get(document, "createElement9512") === "function",
    timers: !/\[native code\]/.test(Function.prototype.toString.call(window.setTimeout)),
  }));

test("enabled at launch: tames timers, the track plays, disabling waits for a restart", async ({ launch }) => {
  test.setTimeout(120_000);
  const page = await mainWindow(await launch({ plugins: { "performance-improvement": { enabled: true } } }));
  await expect.poll(() => patched(page), { timeout: 15_000 }).toEqual({ rm3: true, timers: true });

  await playTestTrack(page);
  await waitForTrackPlaying(page);

  // The settings dialog marks it restart-only and offers the restart on toggle.
  await openSettings(page);
  await searchbox(page).fill("performance");
  const row = pluginRow(page, "performance-improvement");
  await expect(row.locator(".pill")).toBeVisible();
  await row.getByRole("switch").click();
  await expect(restartBanner(page)).toBeVisible();
  await expect.poll(() => pluginEnabled(page, "performance-improvement")).toBe(false);
  // Still patched until the restart.
  expect(await patched(page)).toEqual({ rm3: true, timers: true });
});

test("enabled live: nothing is patched until the next launch", async ({ page }) => {
  await setEnabled(page, "performance-improvement", true);
  await expect.poll(() => pluginEnabled(page, "performance-improvement")).toBe(true);
  await page.waitForTimeout(SETTLE_MS);
  expect(await patched(page)).toEqual({ rm3: false, timers: false });
});
