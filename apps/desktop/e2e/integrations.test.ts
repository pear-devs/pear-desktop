// Now-playing integrations against fake local services: Discord (IPC),
// ListenBrainz, Tuna, Lumia Stream, Amuse and native notifications.

import { networkInterfaces } from "node:os";
import { expect, test } from "@playwright/test";
import { closeApp, fakeDiscord, recordingServer, waitForTrackPlaying } from "./integrations-helpers.ts";
import { launchApp, mainWindow, playTestTrack, TEST_TRACK } from "./launch.ts";

const LUMIA_PORT = 39231;

test("integrations report the playing track and follow pause and disable", async () => {
  test.setTimeout(240_000);
  const listenbrainz = await recordingServer();
  const tuna = await recordingServer();
  const lumia = await recordingServer(LUMIA_PORT);
  const amusePort = 30000 + Math.floor(Math.random() * 20000);
  const discord = fakeDiscord();

  const savedRuntimeDir = process.env.XDG_RUNTIME_DIR;
  if (process.platform === "linux") process.env.XDG_RUNTIME_DIR = discord.env.XDG_RUNTIME_DIR;
  const app = await launchApp({
    plugins: {
      discord: { enabled: process.platform === "linux" },
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
  if (savedRuntimeDir === undefined) delete process.env.XDG_RUNTIME_DIR;
  else process.env.XDG_RUNTIME_DIR = savedRuntimeDir;

  try {
    // Record notifications instead of showing them.
    await app.evaluate(({ Notification }) => {
      const shown: { title: string; body: string }[] = [];
      (globalThis as { __notifications?: typeof shown }).__notifications = shown;
      Notification.prototype.show = function (this: Electron.Notification) {
        shown.push({ title: this.title, body: this.body });
      };
    });
    const notifications = () =>
      app.evaluate(() => (globalThis as { __notifications?: { title: string; body: string }[] }).__notifications ?? []);

    const page = await mainWindow(app);
    // Discord isn't "running" at launch: the plugin must find it once it starts.
    await page.waitForTimeout(1000);
    await discord.listen();

    const amuse = async () => (await fetch(`http://127.0.0.1:${amusePort}/query`)).json();
    await expect.poll(async () => (await amuse().catch(() => null))?.player.hasSong).toBe(false);

    await playTestTrack(page);
    await waitForTrackPlaying(page);
    const track = (await page.evaluate(() => window.__pearRuntime!.player.state.track))!;

    await expect.poll(async () => (await amuse()).track).toMatchObject({ id: TEST_TRACK, title: track.title, author: track.artist });
    // Like pear-desktop, it listens on every interface, so widgets on other devices reach it.
    const lan = Object.values(networkInterfaces()).flat().find((address) => address && address.family === "IPv4" && !address.internal);
    if (lan) expect((await (await fetch(`http://${lan.address}:${amusePort}/query`)).json()).track.id).toBe(TEST_TRACK);
    expect((await amuse()).player.isPaused).toBe(false);

    await expect.poll(notifications).toContainEqual({ title: track.title, body: track.artist });

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

    const tunaPosts = () => tuna.requests.filter((r) => r.method === "POST").map((r) => r.body.data);
    await expect.poll(() => tunaPosts().at(-1)).toMatchObject({ title: track.title, status: "playing", url: track.url });

    const lumiaPosts = () => lumia.requests.filter((r) => r.url === "/api/media").map((r) => r.body);
    await expect.poll(() => lumiaPosts()[0]).toMatchObject({ token: expect.any(String), data: { eventType: "switchSong", videoId: TEST_TRACK } });
    // While playing, progress goes out every second, as pear-desktop did.
    const progressCount = lumiaPosts().length;
    await expect.poll(() => lumiaPosts().length, { timeout: 10_000 }).toBeGreaterThanOrEqual(progressCount + 3);
    const progress = lumiaPosts().slice(-3).map((post) => post.data.progress as number);
    expect(progress[2]!).toBeGreaterThan(progress[0]!);

    if (process.platform === "linux") {
      // First attempt failed (no Discord yet); the retry finds it.
      await expect.poll(() => discord.activities.at(-1), { timeout: 30_000 }).toMatchObject({
        type: 2,
        details_url: track.url,
        timestamps: { start: expect.any(Number), end: expect.any(Number) },
      });

      // pear-desktop's menu items are settings buttons: the connection state, and clearing the activity.
      await page.keyboard.press("Control+,");
      const settings = page.locator("pear-settings");
      await settings.getByRole("navigation").getByRole("button", { name: "Plugins" }).click();
      const card = settings.locator('[data-plugin="discord"]');
      await expect(card.locator(".status-text")).toHaveText("Connected to Discord");
      await card.locator(".plugin-toggle").click();
      await card.locator('[data-action="clearActivity"] button').click();
      await expect.poll(() => discord.activities.at(-1)).toBeNull();
      // Connecting while connected changes nothing.
      await card.locator('[data-action="connect"] button').click();
      await expect(card.locator(".plugin-actions .error-text")).toHaveCount(0);
      await page.keyboard.press("Escape");
    }

    await page.evaluate(() => window.__pearRuntime!.player.control({ type: "pause" }));
    await expect.poll(async () => (await amuse()).player.isPaused).toBe(true);
    await expect.poll(() => tunaPosts().at(-1)?.status).toBe("stopped");
    await expect.poll(() => lumiaPosts().at(-1)?.data).toMatchObject({ eventType: "playPause", isPaused: true });
    if (process.platform === "linux") {
      await expect.poll(() => discord.activities.at(-1)?.assets?.large_text, { timeout: 15_000 }).toBe("⏸︎");
      expect(discord.activities.at(-1)!.timestamps).toBeUndefined();

      // Disabling clears the activity and disconnects.
      await page.evaluate(() => window.__pear!.invoke("plugin:set-enabled", "discord", false));
      await expect.poll(() => discord.activities.at(-1)).toBeNull();
      await expect.poll(() => discord.connections()).toBe(0);
    }

    await page.evaluate(() => window.__pear!.invoke("plugin:set-enabled", "amuse", false));
    await expect.poll(async () => (await amuse().catch(() => "down")) === "down").toBe(true);
  } finally {
    await closeApp(app);
    discord.close();
    await Promise.all([listenbrainz.close(), tuna.close(), lumia.close()]);
  }
});
