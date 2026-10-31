// sponsorblock: skips a music video's non-music intro, using live SponsorBlock data.

import { ytmUrl } from "@pear/sdk/util";
import { expect, test } from "./fixtures.ts";
import { invoke } from "./helpers/plugins.ts";

// "Despacito": a locked music_offtopic segment covers its first ~21.8 s.
const VIDEO = "kJQP7kiw5Fk";
const INTRO_END = 21;
/** Playing through the intro would take 21+ s (plus loading); the skip makes it near-instant. */
const SKIPPED_WITHIN_MS = 18_000;
/** It jumps to the segment's end, not further. */
const LANDING_MARGIN_S = 10;

test.use({
  appOptions: {
    plugins: {
      sponsorblock: { enabled: true },
      // Gets through logged-out pre-rolls quickly.
      "do-not-track": { enabled: true },
    },
  },
});

test("sponsorblock skips the non-music intro of a music video", async ({ page }) => {
  test.setTimeout(120_000);
  const segments = await invoke<{ segment: [number, number]; category: string }[]>(page, "sponsorblock", "segments", VIDEO);
  expect(segments.some((s) => s.category === "music_offtopic" && s.segment[0] < 1 && s.segment[1] > INTRO_END)).toBe(true);

  const opened = Date.now();
  await page.goto(ytmUrl(`/watch?v=${VIDEO}`));
  const position = () =>
    page.evaluate((id) => {
      const { state } = window.__pearRuntime!.player;
      const video = document.querySelector("video");
      if (!state.ad && video?.paused) void video.play();
      return !state.ad && state.track?.videoId === id ? document.querySelector("video")!.currentTime : -1;
    }, VIDEO);
  await expect.poll(position, { timeout: 60_000 }).toBeGreaterThan(INTRO_END);
  expect(Date.now() - opened).toBeLessThan(SKIPPED_WITHIN_MS);
  expect(await position()).toBeLessThan(INTRO_END + LANDING_MARGIN_S);
});
