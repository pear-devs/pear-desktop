// Getting a track to play in a logged-out session, past YTM's pre-roll ads.

import { selectors } from "@pear/sdk/selectors";
import type { Page } from "@playwright/test";

/** Long enough for two pre-roll ads and a slow start. */
const TRACK_PLAYING_TIMEOUT_MS = 120_000;
/** The track must keep playing this long: YTM can start a second ad right after the first. */
const STABLE_MS = 2000;
const POLL_MS = 500;

declare global {
  interface Window {
    /** When the track was last seen playing without interruption (waitForTrackPlaying). */
    __pearPlayingSince?: number | undefined;
  }
}

/**
 * Waits until the track itself (not an ad) plays, with the player bar's track
 * controls shown, for a couple of seconds. Ads are skipped to their end, and
 * paused media is started like a user would.
 */
export async function waitForTrackPlaying(page: Page, timeout = TRACK_PLAYING_TIMEOUT_MS) {
  await page.evaluate(() => {
    window.__pearPlayingSince = undefined;
  });
  await page.waitForFunction(
    ({ stableMs, middleButtons }) => {
      const { state } = window.__pearRuntime!.player;
      const video = document.querySelector("video");
      if (state.ad && video?.duration) video.currentTime = video.duration;
      if (video?.paused) void video.play().catch(() => {});
      // During ads the player bar hides the track controls (likes, menu).
      const controls = document.querySelector(middleButtons);
      const playing = !state.ad && !!state.track && state.status === "playing" && !!video && !video.paused && state.positionSeconds > 0;
      if (!playing || (controls && !controls.checkVisibility())) {
        window.__pearPlayingSince = undefined;
        return false;
      }
      window.__pearPlayingSince ??= Date.now();
      return Date.now() - window.__pearPlayingSince > stableMs;
    },
    { stableMs: STABLE_MS, middleButtons: selectors["player_bar.middle_buttons"] },
    { timeout, polling: POLL_MS },
  );
}

export const playerStatus = (page: Page) => page.evaluate(() => window.__pearRuntime!.player.state.status);

export const pause = (page: Page) => page.evaluate(() => window.__pearRuntime!.player.control({ type: "pause" }));
