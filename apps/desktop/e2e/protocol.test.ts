// pear-desktop's app protocol: a second instance started with a "…music://"
// link hands the command to the running app.

import { expect, test } from "./fixtures.ts";
import { playerStatus, waitForTrackPlaying } from "./helpers/playback.ts";
import { playTestTrack } from "./launch.ts";

const link = (command: string) => `\u0079\u006f\u0075\u0074\u0075\u0062\u0065music://${command}`;

test("protocol links control playback", async ({ app, page }) => {
  test.setTimeout(150_000);
  await playTestTrack(page);
  await waitForTrackPlaying(page);
  const status = () => playerStatus(page);
  const secondInstance = (url: string) =>
    app.evaluate(({ app }, url) => app.emit("second-instance", {}, ["pear", url], ""), url);

  await secondInstance(link("pause"));
  await expect.poll(status).toBe("paused");
  await secondInstance(link("playPause"));
  await expect.poll(status, { timeout: 30_000 }).toMatch(/playing|buffering/);
  await secondInstance(link("seekTo%2030"));
  await expect.poll(() => page.evaluate(() => document.querySelector("video")!.currentTime)).toBeGreaterThan(29);
});
