// Now-playing integrations against fake local services: Discord (IPC),
// ListenBrainz, Tuna, Lumia Stream, Amuse and native notifications.

import { networkInterfaces } from "node:os";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { fakeDiscord } from "./helpers/discord.ts";
import { randomPort, recordingServer } from "./helpers/network.ts";
import { pause, waitForTrackPlaying } from "./helpers/playback.ts";
import { setEnabled } from "./helpers/plugins.ts";
import { openSection, openSettings, pluginRow } from "./helpers/settings.ts";
import "./helpers/probes.ts";
import { mainWindow, playTestTrack, TEST_TRACK } from "./launch.ts";

const LUMIA_PORT = 39231;
/** Lumia gets the progress every second while playing: a few posts in this long. */
const PROGRESS_WINDOW_MS = 10_000;
const PROGRESS_POSTS = 3;
/** Discord isn't "running" at launch for this long: the plugin must find it once it starts. */
const DISCORD_LATE_MS = 1000;

/** Plays the test track and returns it as the page sees it. */
async function playingTrack(page: Page) {
  await playTestTrack(page);
  await waitForTrackPlaying(page);
  return (await page.evaluate(() => window.__pearRuntime!.player.state.track))!;
}

test("now-playing services report the playing track and follow pause and disable", async ({ launch, defer }) => {
  test.setTimeout(240_000);
  const listenbrainz = await recordingServer();
  const tuna = await recordingServer();
  const lumia = await recordingServer(LUMIA_PORT);
  defer(() => Promise.all([listenbrainz.close(), tuna.close(), lumia.close()]));
  const amusePort = randomPort();
  const app = await launch({
    plugins: {
      scrobbler: {
        enabled: true,
        config: {
          listenbrainzEnabled: true,
          listenbrainzToken: "e2e-token",
          listenbrainzApiRoot: `http://127.0.0.1:${listenbrainz.port}/1/`,
        },
      },
      "tuna-obs": { enabled: true, config: { port: tuna.port } },
      lumiastream: { enabled: true },
      amuse: { enabled: true, config: { port: amusePort } },
      notifications: { enabled: true },
    },
  });

  // Record notifications instead of showing them.
  await app.evaluate(({ Notification }) => {
    const shown: { title: string; body: string }[] = [];
    globalThis.__notifications = shown;
    Notification.prototype.show = function (this: Electron.Notification) {
      shown.push({ title: this.title, body: this.body });
    };
  });
  const notifications = () => app.evaluate(() => globalThis.__notifications ?? []);

  const page = await mainWindow(app);
  const amuse = async () => (await fetch(`http://127.0.0.1:${amusePort}/query`)).json();
  await expect.poll(async () => (await amuse().catch(() => null))?.player.hasSong).toBe(false);

  const track = await playingTrack(page);

  await test.step("Amuse", async () => {
    await expect.poll(async () => (await amuse()).track).toMatchObject({ id: TEST_TRACK, title: track.title, author: track.artist });
    // Like pear-desktop, it listens on every interface, so widgets on other devices reach it.
    const lan = Object.values(networkInterfaces()).flat().find((address) => address && address.family === "IPv4" && !address.internal);
    if (lan) expect((await (await fetch(`http://${lan.address}:${amusePort}/query`)).json()).track.id).toBe(TEST_TRACK);
    expect((await amuse()).player.isPaused).toBe(false);
  });

  await test.step("notifications", async () => {
    await expect.poll(notifications).toContainEqual({ title: track.title, body: track.artist });
  });

  await test.step("ListenBrainz", async () => {
    const playingNow = () =>
      listenbrainz.requests.find((r) => r.url === "/1/submit-listens" && r.body?.listen_type === "playing_now");
    await expect.poll(playingNow).toBeTruthy();
    expect(playingNow()!.headers.authorization).toBe("Token e2e-token");
    expect(playingNow()!.body.payload[0].track_metadata).toMatchObject({
      artist_name: expect.any(String),
      track_name: expect.any(String),
      additional_info: { origin_url: track.url },
    });
    // A scrobble needs minutes of listening; the timing is unit-tested.
    expect(listenbrainz.requests.some((r) => r.body?.listen_type === "single")).toBe(false);
  });

  const tunaPosts = () => tuna.requests.filter((r) => r.method === "POST").map((r) => r.body.data);
  await test.step("Tuna", async () => {
    await expect.poll(() => tunaPosts().at(-1)).toMatchObject({ title: track.title, status: "playing", url: track.url });
  });

  const lumiaPosts = () => lumia.requests.filter((r) => r.url === "/api/media").map((r) => r.body);
  await test.step("Lumia Stream", async () => {
    await expect.poll(() => lumiaPosts()[0]).toMatchObject({ token: expect.any(String), data: { eventType: "switchSong", videoId: TEST_TRACK } });
    // The view count comes from the page's song details (ctx.player.details()).
    await expect.poll(() => lumiaPosts().at(-1)?.data.views).toEqual(expect.any(Number));
    // While playing, progress goes out every second, as pear-desktop did.
    const progressCount = lumiaPosts().length;
    await expect.poll(() => lumiaPosts().length, { timeout: PROGRESS_WINDOW_MS }).toBeGreaterThanOrEqual(progressCount + PROGRESS_POSTS);
    const progress = lumiaPosts().slice(-PROGRESS_POSTS).map((post) => post.data.progress as number);
    expect(progress.at(-1)!).toBeGreaterThan(progress[0]!);
  });

  await test.step("pausing", async () => {
    await pause(page);
    await expect.poll(async () => (await amuse()).player.isPaused).toBe(true);
    await expect.poll(() => tunaPosts().at(-1)?.status).toBe("stopped");
    await expect.poll(() => lumiaPosts().at(-1)?.data).toMatchObject({ eventType: "playPause", isPaused: true });
  });

  await setEnabled(page, "amuse", false);
  await expect.poll(async () => (await amuse().catch(() => "down")) === "down").toBe(true);
});

test("Discord Rich Presence finds Discord once it runs, and follows pause and disable", async ({ launch, defer }) => {
  test.skip(process.platform !== "linux", "the fake Discord listens on a Unix socket");
  test.setTimeout(240_000);
  const discord = fakeDiscord();
  defer(() => discord.close());
  const page = await mainWindow(await launch({ env: discord.env, plugins: { discord: { enabled: true } } }));
  await page.waitForTimeout(DISCORD_LATE_MS);
  await discord.listen();
  const track = await playingTrack(page);

  // The first attempt failed (no Discord yet); the retry finds it.
  await expect.poll(() => discord.activities.at(-1), { timeout: 30_000 }).toMatchObject({
    type: 2,
    details_url: track.url,
    timestamps: { start: expect.any(Number), end: expect.any(Number) },
  });

  await test.step("pear-desktop's menu items are settings buttons", async () => {
    await openSettings(page);
    await openSection(page, "Plugins");
    const card = pluginRow(page, "discord");
    await expect(card.locator(".status-text")).toHaveText("Connected to Discord");
    await card.locator(".plugin-toggle").click();
    await card.locator('[data-action="clearActivity"] button').click();
    await expect.poll(() => discord.activities.at(-1)).toBeNull();
    // Connecting while connected changes nothing.
    await card.locator('[data-action="connect"] button').click();
    await expect(card.locator(".plugin-actions .error-text")).toHaveCount(0);
    await page.keyboard.press("Escape");
  });

  await pause(page);
  await expect.poll(() => discord.activities.at(-1)?.assets?.large_text, { timeout: 15_000 }).toBe("⏸︎");
  expect(discord.activities.at(-1)!.timestamps).toBeUndefined();

  // Disabling clears the activity and disconnects.
  await setEnabled(page, "discord", false);
  await expect.poll(() => discord.activities.at(-1)).toBeNull();
  await expect.poll(() => discord.connections()).toBe(0);
});
