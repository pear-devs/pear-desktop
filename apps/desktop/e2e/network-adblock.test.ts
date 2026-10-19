// adblock: network filtering composes with core CSP stripping, and player ads
// are skipped without cutting into the track.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { launchApp, mainWindow, playTestTrack } from "./launch.ts";
import { closeApp, invoke } from "./network-helpers.ts";

test("adblock blocks requests, keeps the runtime and gets to the track's start quickly", async () => {
  test.setTimeout(120_000);
  const app = await launchApp({ plugins: { adblock: { enabled: true } } });
  let page: Page | undefined;
  try {
    // The runtime still injects: the blocker's webRequest listeners didn't replace CSP stripping.
    page = await mainWindow(app);
    const stats = () => invoke<{ active: boolean; blocked: number }>(page!, "adblock", "stats");
    await expect.poll(async () => (await stats()).active, { timeout: 30_000 }).toBe(true);
    await playTestTrack(page);

    // Watch until the track itself plays (playing it like a user if autoplay was refused).
    let adSeenAt: number | undefined;
    let adGoneAt: number | undefined;
    const deadline = Date.now() + 45_000;
    let state = { ad: false, playing: false, position: 0 };
    while (Date.now() < deadline) {
      state = await page.evaluate(() => {
        const s = window.__pearRuntime!.player.state;
        const video = document.querySelector("video");
        if (!s.ad && video?.paused) void video.play();
        return { ad: s.ad, playing: s.status === "playing", position: s.positionSeconds };
      });
      if (state.ad) adSeenAt ??= Date.now();
      else if (adSeenAt && !adGoneAt) adGoneAt = Date.now();
      if (!state.ad && state.playing && state.position >= 1) break;
      await page.waitForTimeout(250);
    }
    expect(state).toMatchObject({ ad: false, playing: true });
    // From the track's start: the ad was skipped, not the track.
    expect(state.position).toBeLessThan(15);
    if (adSeenAt) expect((adGoneAt ?? Date.now()) - adSeenAt).toBeLessThan(10_000);
    // Playback speed and mute are back to normal.
    expect(await page.evaluate(() => ({ rate: document.querySelector("video")!.playbackRate, muted: document.querySelector("video")!.muted }))).toEqual({ rate: 1, muted: false });

    expect((await stats()).blocked).toBeGreaterThan(0);
    // The engine is cached for the next launch.
    const cache = join(app.userData, "adblock");
    expect(existsSync(cache) && readdirSync(cache).some((f) => /^engine-\w+\.bin$/.test(f))).toBe(true);

    // Disabling works live.
    await page.evaluate(() => window.__pear!.invoke("plugin:set-enabled", "adblock", false));
    await expect(stats()).rejects.toThrow(/disabled/);
  } finally {
    await closeApp(app, page);
  }
});
