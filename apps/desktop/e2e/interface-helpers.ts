// Shared by the interface*.test.ts files.

import type { ElectronApplication, Page } from "@playwright/test";

/** Set PEAR_SCREENSHOTS=<dir> to save screenshots for a visual check. */
export async function screenshot(page: Page, name: string) {
  const dir = process.env.PEAR_SCREENSHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` });
}

export const setEnabled = (page: Page, id: string, enabled: boolean) =>
  page.evaluate(([id, enabled]) => window.__pear!.invoke("plugin:set-enabled", id, enabled), [id, enabled] as const);

export const setConfig = (page: Page, id: string, patch: Record<string, unknown>) =>
  page.evaluate(([id, patch]) => window.__pear!.invoke("plugin:set-config", id, patch), [id, patch] as const);

/** Quits without waiting for YTM's "leave site?" prompt while something plays. */
export async function quit(app: ElectronApplication) {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await app.close().catch(() => {});
}

/** Lets logged-out pre-roll ads (there may be two) finish quickly so the track itself plays. */
export async function skipAds(page: Page) {
  await page.waitForFunction(
    () => {
      const { state } = window.__pearRuntime!.player;
      const video = document.querySelector("video");
      const w = window as unknown as { __pearNoAdSince: number | undefined };
      if (state.ad && video) {
        if (video.duration) video.currentTime = video.duration;
        if (video.paused) void video.play();
      }
      // During ads the player bar hides the track controls (likes, menu).
      const controls = document.querySelector("ytmusic-player-bar .middle-controls-buttons");
      const waiting = state.ad || !state.track || (controls && !controls.checkVisibility());
      if (waiting && video?.paused) void video.play();
      if (waiting) w.__pearNoAdSince = undefined;
      else w.__pearNoAdSince ??= Date.now();
      return w.__pearNoAdSince !== undefined && Date.now() - w.__pearNoAdSince > 2000;
    },
    undefined,
    { timeout: 90_000, polling: 500 },
  ).catch(async (error) => {
    console.log("SKIPADS", await page.evaluate(() => JSON.stringify({ s: window.__pearRuntime!.player.state, c: document.querySelector("ytmusic-player-bar .middle-controls-buttons")?.checkVisibility(), p: document.querySelector("video")?.paused, bar: document.querySelector("ytmusic-player-bar")?.textContent?.replace(/\s+/g, " ").slice(0, 200) })));
    throw error;
  });
}
