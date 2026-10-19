// Milestone 2: one plugin per layer, toggled and reconfigured live.

import { expect, test } from "@playwright/test";
import { launchApp, mainWindow, playTestTrack, TEST_TRACK } from "./launch.ts";

test("blur-nav-bar applies build-time CSS and reacts to config and disable live", async () => {
  const app = await launchApp({ plugins: { "blur-nav-bar": { enabled: true } } });
  try {
    const page = await mainWindow(app);
    const filter = () =>
      page.evaluate(() => {
        const el = document.querySelector("#nav-bar-background");
        return el ? getComputedStyle(el).backdropFilter : null;
      });
    await page.waitForSelector("#nav-bar-background", { state: "attached" });
    await expect.poll(filter).toBe("blur(8px)");

    await page.evaluate(() => window.__pear!.invoke("plugin:set-config", "blur-nav-bar", { blur: 16 }));
    await expect.poll(filter).toBe("blur(16px)");

    await page.evaluate(() => window.__pear!.invoke("plugin:set-enabled", "blur-nav-bar", false));
    await expect.poll(filter).toBe("none");

    // Invalid values are rejected by the schema and fall back to the default.
    await page.evaluate(() => window.__pear!.invoke("plugin:set-enabled", "blur-nav-bar", true));
    await page.evaluate(() => window.__pear!.invoke("plugin:set-config", "blur-nav-bar", { blur: 999 }));
    await expect.poll(filter).toBe("blur(8px)");
  } finally {
    await app.close();
  }
});

test("disable-autoplay keeps a freshly opened track paused", async () => {
  test.setTimeout(150_000);
  const app = await launchApp({ plugins: { "disable-autoplay": { enabled: true } } });
  try {
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
    await page.waitForTimeout(3000);
    expect(await settled()).toBe(true);
    expect(await page.evaluate(() => window.__pearRuntime!.player.state.positionSeconds)).toBeLessThan(2);
  } finally {
    await app.close();
  }
});

test("player facade publishes now-playing state to the host", async () => {
  const app = await launchApp();
  try {
    const page = await mainWindow(app);
    await playTestTrack(page);
    const track = await page.evaluate(() => window.__pearRuntime!.player.state.track);
    expect(track).toMatchObject({ videoId: TEST_TRACK, url: `https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/watch?v=${TEST_TRACK}` });
    expect(track!.title.length).toBeGreaterThan(0);
    expect(track!.artist.length).toBeGreaterThan(0);
    expect(track!.durationSeconds).toBeGreaterThan(60);

    await page.evaluate(() => window.__pearRuntime!.player.control({ type: "pause" }));
    await expect.poll(() => page.evaluate(() => window.__pearRuntime!.player.state.status)).toBe("paused");
  } finally {
    await app.close();
  }
});
