// music-together end to end: two app instances, a real PeerJS broker and
// WebRTC data channel, real YTM players. The session logic itself is unit
// tested in plugins/music-together/test.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { launchApp, mainWindow, playTestTrack, TEST_TRACK } from "./launch.ts";

const SCREENSHOTS = process.env.PEAR_SCREENSHOTS;

async function screenshot(app: ElectronApplication, name: string) {
  if (!SCREENSHOTS) return;
  // Let the compositor catch up with the last DOM change.
  await new Promise((resolve) => setTimeout(resolve, 600));
  const png = await app.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString("base64"),
  );
  writeFileSync(join(SCREENSHOTS, `${name}.png`), Buffer.from(png, "base64"));
}

/** app.close() can hang after media playback; don't let that fail the test. */
async function close(app: ElectronApplication) {
  const process = app.process();
  await Promise.race([app.close(), new Promise((resolve) => setTimeout(resolve, 10_000))]);
  if (process.exitCode === null) process.kill("SIGKILL");
}

const panel = (page: Page) => page.locator("pear-together .panel");
const openPanel = async (page: Page) => {
  await page.locator("pear-together-button").getByRole("button", { name: "Music Together" }).click();
  await expect(panel(page)).toBeVisible();
};

/** Plays through (or starts) pre-roll ads like a user would. */
const playAds = (page: Page) =>
  page.evaluate(() => {
    const video = document.querySelector("video");
    if (window.__pearRuntime!.player.state.ad && video?.paused) void video.play();
  });

const playerState = (page: Page) =>
  page.evaluate(() => {
    const { state } = window.__pearRuntime!.player;
    return { videoId: state.track?.videoId, status: state.status, ad: state.ad };
  });

test("a guest joins by code and follows the host's track and pause", async () => {
  test.setTimeout(240_000);
  const plugins = (name: string) => ({ "music-together": { enabled: true, config: { displayName: name } } });
  const hostApp = await launchApp({ plugins: plugins("Hosty") });
  const guestApp = await launchApp({ plugins: plugins("Gus") });
  try {
    const [host, guest] = await Promise.all([mainWindow(hostApp), mainWindow(guestApp)]);
    await playTestTrack(host);

    await openPanel(host);
    await panel(host).getByRole("button", { name: "Start a session" }).click();
    const code = panel(host).locator("code[data-code]");
    await expect(code).toBeVisible({ timeout: 30_000 });
    const roomCode = (await code.getAttribute("data-code"))!;
    expect(roomCode).toMatch(/^[A-Z2-9]{6}$/);

    await openPanel(guest);
    await panel(guest).getByLabel("Session code").fill(roomCode.toLowerCase());
    await panel(guest).getByRole("button", { name: "Join" }).click();
    await expect(panel(guest).getByText("With Hosty")).toBeVisible({ timeout: 30_000 });

    // Both see each other.
    await expect(panel(host).locator(".people li")).toHaveCount(2);
    await expect(panel(host).locator(".people")).toContainText("Gus");
    await expect(panel(guest).locator(".people")).toContainText("Hosty");
    await expect(host.locator("pear-together .toast").filter({ hasText: "Gus joined" })).toBeVisible();

    // The guest loads and plays the host's track.
    await expect
      .poll(async () => (await playAds(guest), (await playerState(guest)).videoId), { timeout: 60_000 })
      .toBe(TEST_TRACK);
    await expect
      .poll(async () => (await Promise.all([playAds(host), playAds(guest)]), await playerState(guest)), { timeout: 90_000 })
      .toMatchObject({ ad: false, status: "playing" });
    await screenshot(hostApp, "together-host");
    await screenshot(guestApp, "together-guest");

    // Host pauses: the guest follows.
    await expect.poll(async () => (await playAds(host), (await playerState(host)).ad), { timeout: 90_000 }).toBe(false);
    await host.evaluate(() => window.__pearRuntime!.player.control({ type: "pause" }));
    await expect.poll(async () => (await playerState(guest)).status, { timeout: 15_000 }).toBe("paused");

    // Guest suggestions land in the host's queue (default permission: suggest).
    await panel(guest).getByLabel("Song link").fill("https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/watch?v=fJ9rUzIMcZQ");
    await panel(guest).getByRole("button", { name: "Suggest" }).click();
    await expect(panel(host).locator('.queue li[data-video="fJ9rUzIMcZQ"]')).toBeVisible({ timeout: 20_000 });
    await expect(panel(guest).locator('.queue li[data-video="fJ9rUzIMcZQ"]')).toContainText("added by Gus");
    await screenshot(hostApp, "together-host-queue");

    // Ending the session disconnects the guest.
    await panel(host).getByRole("button", { name: "End session" }).click();
    await expect(panel(guest).getByText("The host ended the session")).toBeVisible({ timeout: 15_000 });

    // Disabling the plugin removes its UI.
    await guest.evaluate(() => window.__pear!.invoke("plugin:set-enabled", "music-together", false));
    await expect(guest.locator("pear-together-button")).toHaveCount(0);
    await expect(guest.locator("pear-together")).toHaveCount(0);
  } finally {
    await Promise.all([close(hostApp), close(guestApp)]);
  }
});
