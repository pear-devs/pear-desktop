// performance-improvement patches the page's timers for good, so it only runs
// when enabled at page load; toggling it asks for a restart instead.

import { expect, type Page, test } from "@playwright/test";
import { launchApp, mainWindow, playTestTrack } from "./launch.ts";
import { closeApp } from "./network-helpers.ts";

const overlay = (page: Page) => page.locator("pear-settings");

/** rm3 keeps the original createElement; cpu-tamer replaces the native setTimeout. */
const patched = (page: Page) =>
  page.evaluate(() => ({
    rm3: typeof (document as unknown as Record<string, unknown>).createElement9512 === "function",
    timers: !/\[native code\]/.test(Function.prototype.toString.call(window.setTimeout)),
  }));

test("enabled at launch: tames timers, the track plays, disabling waits for a restart", async () => {
  test.setTimeout(120_000);
  const app = await launchApp({ plugins: { "performance-improvement": { enabled: true } } });
  let page: Page | undefined;
  try {
    page = await mainWindow(app);
    await expect.poll(() => patched(page!), { timeout: 15_000 }).toEqual({ rm3: true, timers: true });

    await playTestTrack(page);
    await expect
      .poll(
        () =>
          page!.evaluate(() => {
            const video = document.querySelector("video");
            if (video?.paused) void video.play();
            const s = window.__pearRuntime!.player.state;
            return s.status === "playing" && s.positionSeconds >= 2;
          }),
        { timeout: 45_000, intervals: [500] },
      )
      .toBe(true);

    // The settings dialog marks it restart-only and offers the restart on toggle.
    await page.keyboard.press("Control+,");
    await overlay(page).getByRole("searchbox").fill("performance");
    const row = overlay(page).locator('[data-plugin="performance-improvement"]');
    await expect(row.locator(".pill")).toBeVisible();
    await row.getByRole("switch").click();
    await expect(overlay(page).getByRole("status").filter({ hasText: "restart" })).toBeVisible();
    await expect.poll(() => page!.evaluate(() => window.__pearRuntime!.plugins.state("performance-improvement")?.enabled)).toBe(false);
    // Still patched until the restart.
    expect(await patched(page)).toEqual({ rm3: true, timers: true });
  } finally {
    await closeApp(app, page);
  }
});

test("enabled live: nothing is patched until the next launch", async () => {
  const app = await launchApp();
  let page: Page | undefined;
  try {
    page = await mainWindow(app);
    await page.evaluate(() => window.__pear!.invoke("plugin:set-enabled", "performance-improvement", true));
    await expect.poll(() => page!.evaluate(() => window.__pearRuntime!.plugins.state("performance-improvement")?.enabled)).toBe(true);
    await page.waitForTimeout(2000);
    expect(await patched(page)).toEqual({ rm3: false, timers: false });
  } finally {
    await closeApp(app, page);
  }
});
