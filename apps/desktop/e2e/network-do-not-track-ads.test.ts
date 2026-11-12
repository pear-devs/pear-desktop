// do-not-track: ads that still play are skipped without cutting into the track.

import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { invoke, setEnabled } from "./helpers/plugins.ts";
import { playTestTrack } from "./launch.ts";

const WATCH_MS = 45_000;
const POLL_MS = 250;
/** The track starts from (near) its start: the ad was skipped, not the track. */
const MAX_START_S = 15;
/** do-not-track gets through an ad within this. */
const MAX_AD_MS = 10_000;

test.use({ appOptions: { plugins: { "do-not-track": { enabled: true } } } });

/**
 * Watches until the track itself plays (playing it like a user if autoplay was
 * refused); returns its state then and how long an ad was on screen.
 */
async function watchUntilTrackPlays(page: Page) {
  let adSeenAt: number | undefined;
  let adGoneAt: number | undefined;
  const deadline = Date.now() + WATCH_MS;
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
    await page.waitForTimeout(POLL_MS);
  }
  const adMs = adSeenAt === undefined ? undefined : (adGoneAt ?? Date.now()) - adSeenAt;
  return { state, adMs };
}

test("do-not-track gets to the track's start quickly, skipping ads that still play", async ({ page }) => {
  test.setTimeout(120_000);
  await playTestTrack(page);
  const { state, adMs } = await watchUntilTrackPlays(page);
  expect(state).toMatchObject({ ad: false, playing: true });
  expect(state.position).toBeLessThan(MAX_START_S);
  if (adMs !== undefined) expect(adMs).toBeLessThan(MAX_AD_MS);
  // Playback speed and mute are back to normal.
  expect(await page.evaluate(() => ({ rate: document.querySelector("video")!.playbackRate, muted: document.querySelector("video")!.muted }))).toEqual({ rate: 1, muted: false });

  // Disabling works live.
  await setEnabled(page, "do-not-track", false);
  await expect(invoke(page, "do-not-track", "stats")).rejects.toThrow(/disabled/);
});

test("do-not-track dismisses the Premium reminder shown after skipped ads", async ({ page }) => {
  test.setTimeout(90_000);
  await page.waitForSelector("ytmusic-popup-container", { state: "attached" });
  // YTM's own dialog and promo elements, opened the way YTM opens them.
  const shown = await page.evaluate(async () => {
    const dialog = document.createElement("tp-yt-paper-dialog") as HTMLElement & { open(): void; opened: boolean };
    dialog.append(document.createElement("ytmusic-mealbar-promo-renderer"));
    document.querySelector("ytmusic-popup-container")!.append(dialog);
    dialog.open();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return getComputedStyle(dialog).display;
  });
  expect(shown).toBe("none");
  await expect
    .poll(() => page.evaluate(() => (document.querySelector("tp-yt-paper-dialog:has(> ytmusic-mealbar-promo-renderer)") as { opened?: boolean }).opened))
    .toBe(false);
});
