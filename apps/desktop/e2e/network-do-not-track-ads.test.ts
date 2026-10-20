// do-not-track: ads that still play are skipped without cutting into the track.

import { expect, type Page, test } from "@playwright/test";
import { launchApp, mainWindow, playTestTrack } from "./launch.ts";
import { closeApp, invoke } from "./network-helpers.ts";

test("do-not-track gets to the track's start quickly, skipping ads that still play", async () => {
  test.setTimeout(120_000);
  const app = await launchApp({ plugins: { "do-not-track": { enabled: true } } });
  let page: Page | undefined;
  try {
    page = await mainWindow(app);
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

    // Disabling works live.
    await page.evaluate(() => window.__pear!.invoke("plugin:set-enabled", "do-not-track", false));
    await expect(invoke(page, "do-not-track", "stats")).rejects.toThrow(/disabled/);
  } finally {
    await closeApp(app, page);
  }
});
