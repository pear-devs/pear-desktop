// synced-lyrics against real YTM (logged out) and real providers.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { launchApp, mainWindow, playTestTrack } from "./launch.ts";

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

/** Waits until the track itself plays (a pre-roll ad may come first; start it if it sits paused). */
async function waitForTrackPlaying(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const { player } = window.__pearRuntime!;
          const video = document.querySelector("video");
          if (video?.paused) void video.play();
          return !player.state.ad && player.state.status === "playing";
        }),
      { timeout: 90_000, intervals: [500] },
    )
    .toBe(true);
}

/** app.close() can hang after media playback; don't let that fail the test. */
async function close(app: ElectronApplication) {
  const process = app.process();
  await Promise.race([app.close(), new Promise((resolve) => setTimeout(resolve, 10_000))]);
  if (process.exitCode === null) process.kill("SIGKILL");
}

const lyrics = (page: Page) => page.locator("pear-synced-lyrics");
const activeIndex = (page: Page) =>
  page.evaluate(() => {
    const lines = [...(document.querySelector("pear-synced-lyrics")?.shadowRoot?.querySelectorAll(".lines .line") ?? [])];
    return lines.findIndex((line) => line.getAttribute("data-state") === "active");
  });

test("shows synced lyrics in the Lyrics tab, follows playback and seeks on click", async () => {
  test.setTimeout(180_000);
  const app = await launchApp({ plugins: { "synced-lyrics": { enabled: true } } });
  try {
    const page = await mainWindow(app);
    await playTestTrack(page);
    await waitForTrackPlaying(page);

    await page.locator("ytmusic-player-page tp-yt-paper-tab").nth(1).click();
    await expect(lyrics(page)).toHaveAttribute("open", "");
    await expect(lyrics(page)).toHaveAttribute("data-state", "synced", { timeout: 30_000 });
    const lines = lyrics(page).locator(".lines .line");
    expect(await lines.count()).toBeGreaterThan(20);
    await expect(lines.filter({ hasText: "We're no strangers to love" }).first()).toBeVisible();
    // YTM's own (unsynced) lyrics are hidden behind ours.
    await expect(page.locator("ytmusic-player-page #tab-renderer > ytmusic-section-list-renderer")).toBeHidden();

    // Seek into the first chorus; the active line must follow playback from there.
    await page.evaluate(() => window.__pearRuntime!.player.control({ type: "seek", seconds: 43 }));
    await expect.poll(() => activeIndex(page)).toBeGreaterThan(0);
    const first = await activeIndex(page);
    await expect.poll(() => activeIndex(page), { timeout: 15_000 }).toBeGreaterThan(first);
    const active = lyrics(page).locator('.line[data-state="active"]');
    await expect(active).toBeInViewport();
    await screenshot(app, "lyrics-synced");

    // Clicking a line seeks to it.
    await lines.filter({ hasText: "We're no strangers to love" }).first().click();
    await expect
      .poll(() => page.evaluate(() => document.querySelector("video")!.currentTime))
      .toBeLessThan(25);
    await expect(active).toContainText("strangers");

    // The provider picker shows what each provider found.
    await expect(lyrics(page).locator('.chip[data-provider="lrclib"]')).toHaveAttribute("aria-checked", "true");
    // Switching to an unsynced provider shows plain lyrics.
    const genius = lyrics(page).locator('.chip[data-provider="genius"]');
    await expect(genius).toHaveAttribute("data-status", /found|none|error/, { timeout: 30_000 });
    if ((await genius.getAttribute("data-status")) === "found") {
      await genius.click();
      await expect(lyrics(page)).toHaveAttribute("data-state", "plain");
      await screenshot(app, "lyrics-plain");
      await lyrics(page).locator('.chip[data-provider="lrclib"]').click();
      await expect(lyrics(page)).toHaveAttribute("data-state", "synced");
    }

    // Disabling restores YTM's own lyrics live.
    await page.evaluate(() => window.__pear!.invoke("plugin:set-enabled", "synced-lyrics", false));
    await expect(lyrics(page)).toHaveCount(0);
  } finally {
    await close(app);
  }
});

test("highlights word by word when the provider has word timing", async () => {
  test.setTimeout(180_000);
  const app = await launchApp({ plugins: { "synced-lyrics": { enabled: true } } });
  try {
    const page = await mainWindow(app);
    await playTestTrack(page);
    await waitForTrackPlaying(page);

    // LRCLIB rarely has word timing, so briefly serve a word-synced entry for the
    // test track (only while searching: proxying all of https would disturb playback).
    await app.evaluate(({ session, net }) => {
      const words = ["Never ", "gonna ", "give ", "you ", "up"];
      const lines = Array.from({ length: 60 }, (_, i) => {
        const start = 3000 + i * 3000;
        return [
          `- text: ${words.join("")}`,
          `  start_ms: ${start}`,
          `  end_ms: ${start + 2500}`,
          "  words:",
          ...words.flatMap((word, w) => [`  - text: ${word.trim()}`, `    start_ms: ${start + w * 500}`, `    end_ms: ${start + w * 500 + 500}`]),
        ].join("\n");
      });
      const entry = {
        id: 1,
        trackName: "Never Gonna Give You Up",
        artistName: "Rick Astley",
        duration: 213,
        instrumental: false,
        hasWordSync: true,
        plainLyrics: "Never gonna give you up",
        syncedLyrics: "[00:03.00]Never gonna give you up",
        lyricsfile: `version: '1.0'\nlines:\n${lines.join("\n")}\n`,
      };
      session.defaultSession.protocol.handle("https", (request) =>
        new URL(request.url).hostname === "lrclib.net"
          ? Response.json([entry])
          : net.fetch(request, { bypassCustomProtocolHandlers: true }),
      );
    });
    // A search setting change searches again (and misses the cache).
    await page.evaluate(() =>
      window.__pear!.invoke("plugin:set-config", "synced-lyrics", { showLyricsEvenIfInexact: false }),
    );
    await page.locator("ytmusic-player-page tp-yt-paper-tab").nth(1).click();
    await expect(lyrics(page).locator('.chip[aria-checked="true"]')).toContainText("words", { timeout: 30_000 });
    await app.evaluate(({ session }) => session.defaultSession.protocol.unhandle("https"));

    // Mid-line: earlier words are filled, later ones not yet.
    await page.evaluate(() => window.__pearRuntime!.player.control({ type: "seek", seconds: 31.2 }));
    const fills = () =>
      page.evaluate(() =>
        [...(document.querySelector("pear-synced-lyrics")?.shadowRoot?.querySelectorAll('.line[data-state="active"] .word') ?? [])].map(
          (word) => Number((word as HTMLElement).style.getPropertyValue("--p")),
        ),
      );
    await expect.poll(async () => (await fills()).length).toBe(5);
    await page.evaluate(() => window.__pearRuntime!.player.control({ type: "pause" }));
    await page.evaluate(() => window.__pearRuntime!.player.control({ type: "seek", seconds: 31.3 }));
    await expect.poll(async () => {
      const [first, , third, , last] = await fills();
      return first === 1 && third! > 0 && third! < 1 && last === 0;
    }).toBe(true);
    await screenshot(app, "lyrics-words");
  } finally {
    await close(app);
  }
});
