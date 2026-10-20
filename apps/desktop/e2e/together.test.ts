// music-together end to end: two app instances, a real PeerJS broker and
// WebRTC data channel, real YTM players. The session logic itself is unit
// tested in plugins/music-together/test.

import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { pause } from "./helpers/playback.ts";
import { setEnabled } from "./helpers/plugins.ts";
import { screenshot } from "./helpers/window.ts";
import { mainWindow, playTestTrack, TEST_TRACK } from "./launch.ts";

/** YTM's queue element and its store (see plugins/music-together/queue.ts). */
interface QueueHost extends HTMLElement {
  queue: { store: { store: { getState(): { queue: { items: Record<string, any>[]; queueContextParams: string } }; dispatch(event: unknown): void } } };
}
interface AppHost extends HTMLElement {
  networkManager: { fetch(path: string, body: unknown): Promise<any> };
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

/** The host's (or guest's) player state, after playing any ad that sits paused. */
async function stateAfterAds(page: Page) {
  await playAds(page);
  return playerState(page);
}

const playerState = (page: Page) =>
  page.evaluate(() => {
    const { state } = window.__pearRuntime!.player;
    return { videoId: state.track?.videoId, status: state.status, ad: state.ad };
  });

/** The YTM queue's video ids. */
const queueIds = (page: Page) =>
  page.evaluate(() => {
    const store = document.querySelector<QueueHost>("#queue")!.queue.store.store;
    return store.getState().queue.items.map(
      (item) =>
        (item.playlistPanelVideoRenderer ?? Object.values(item.playlistPanelVideoWrapperRenderer?.primaryRenderer ?? {})[0])?.videoId as string,
    );
  });

test("pear-desktop's Music Together: a guest joins by host id and shares YTM's queue", async ({ launch }) => {
  test.setTimeout(240_000);
  const plugins = (name: string) => ({ "music-together": { enabled: true, config: { displayName: name } } });
  const hostApp = await launch({ plugins: plugins("Hosty") });
  const guestApp = await launch({ plugins: plugins("Gus") });
  const [host, guest] = await Promise.all([mainWindow(hostApp), mainWindow(guestApp)]);
  await playTestTrack(host);
  await expect.poll(async () => (await stateAfterAds(host)).videoId, { timeout: 60_000 }).toBe(TEST_TRACK);

  // Hosting gives pear-desktop's host id (the raw PeerJS id).
  await openPanel(host);
  await panel(host).getByRole("button", { name: "Music Together Host" }).click();
  const hostId = panel(host).locator("code.host-id");
  await expect(hostId).toBeVisible({ timeout: 30_000 });
  const id = (await hostId.textContent())!;
  expect(id).toMatch(/^[0-9a-f-]{36}$/);

  await openPanel(guest);
  await panel(guest).getByLabel("Enter Host ID").fill(id);
  await panel(guest).getByRole("button", { name: "Join" }).click();
  await expect(panel(guest).getByText("Connected as Guest")).toBeVisible({ timeout: 30_000 });

  // Both see each other, and the host gets YTM's toast.
  await expect(panel(host).locator(".people li")).toHaveCount(2);
  await expect(panel(host).locator(".people")).toContainText("Gus");
  await expect(panel(guest).locator(".people")).toContainText("Hosty");
  await expect(host.getByText("Gus joined Music Together")).toBeVisible();

  // The guest's YTM queue is the host's, and it plays the host's track.
  await expect.poll(() => queueIds(guest), { timeout: 30_000 }).toContain(TEST_TRACK);
  await expect
    .poll(
      async () => {
        await playAds(host);
        return (await stateAfterAds(guest)).videoId;
      },
      { timeout: 90_000 },
    )
    .toBe(TEST_TRACK);
  await screenshot(hostApp, "together-host");
  await screenshot(guestApp, "together-guest");

  // Host pauses: the guest follows.
  await expect.poll(async () => (await stateAfterAds(host)).ad, { timeout: 90_000 }).toBe(false);
  await pause(host);
  await expect.poll(async () => (await playerState(guest)).status, { timeout: 15_000 }).toBe("paused");

  // The guest adds a song with YTM's own queue (what "Add to queue" dispatches): it lands
  // in everyone's queue, marked as the guest's.
  const added = "fJ9rUzIMcZQ";
  await guest.evaluate(async (videoId) => {
    const app = document.querySelector<AppHost>("ytmusic-app")!;
    const store = document.querySelector<QueueHost>("#queue")!.queue.store.store;
    const response = await app.networkManager.fetch("/music/get_queue", { queueContextParams: store.getState().queue.queueContextParams, videoIds: [videoId] });
    store.dispatch({ type: "ADD_ITEMS", payload: { items: response.queueDatas.map((data: { content: unknown }) => data.content) } });
  }, added);
  await expect.poll(() => queueIds(host), { timeout: 20_000 }).toContain(added);
  await expect.poll(() => queueIds(guest), { timeout: 20_000 }).toContain(added);
  await screenshot(hostApp, "together-host-queue");

  // Closing the session disconnects the guest.
  await panel(host).getByRole("button", { name: "Close Music Together" }).click();
  await expect(guest.getByText("Music Together disconnected")).toBeVisible({ timeout: 20_000 });

  // Disabling the plugin removes its UI.
  await setEnabled(guest, "music-together", false);
  await expect(guest.locator("pear-together-button")).toHaveCount(0);
  await expect(guest.locator("pear-together")).toHaveCount(0);
});
