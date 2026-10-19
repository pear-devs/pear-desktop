// sponsorblock: skips a music video's non-music intro, using live SponsorBlock data.

import { expect, type Page, test } from "@playwright/test";
import { launchApp, mainWindow } from "./launch.ts";
import { closeApp, invoke } from "./network-helpers.ts";

// "Despacito": a locked music_offtopic segment covers its first ~21.8 s.
const VIDEO = "kJQP7kiw5Fk";
const INTRO_END = 21;

test("sponsorblock skips the non-music intro of a music video", async () => {
  test.setTimeout(120_000);
  const app = await launchApp({
    plugins: {
      sponsorblock: { enabled: true },
      // Gets through logged-out pre-rolls quickly.
      adblock: { enabled: true, config: { blockRequests: false } },
    },
  });
  let page: Page | undefined;
  try {
    page = await mainWindow(app);
    const segments = await invoke<{ segment: [number, number]; category: string }[]>(page, "sponsorblock", "segments", VIDEO);
    expect(segments.some((s) => s.category === "music_offtopic" && s.segment[0] < 1 && s.segment[1] > INTRO_END)).toBe(true);

    const opened = Date.now();
    await page.goto(`https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/watch?v=${VIDEO}`);
    const position = () =>
      page!.evaluate((id) => {
        const { state } = window.__pearRuntime!.player;
        const video = document.querySelector("video");
        if (!state.ad && video?.paused) void video.play();
        return !state.ad && state.track?.videoId === id ? document.querySelector("video")!.currentTime : -1;
      }, VIDEO);
    await expect.poll(position, { timeout: 60_000 }).toBeGreaterThan(INTRO_END);
    // Playing through the intro would take 21+ s (plus loading); the skip makes it near-instant.
    expect(Date.now() - opened).toBeLessThan(18_000);
    // It jumped to the segment's end, not further.
    expect(await position()).toBeLessThan(INTRO_END + 10);
  } finally {
    await closeApp(app, page);
  }
});
