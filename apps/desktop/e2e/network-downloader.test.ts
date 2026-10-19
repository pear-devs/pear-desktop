// downloader: a real yt-dlp download from the player-bar button, with tags and cover art.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { launchApp, mainWindow, playTestTrack } from "./launch.ts";
import { closeApp, invoke } from "./network-helpers.ts";

const hasTool = (name: string) => {
  try {
    execFileSync(process.platform === "win32" ? "where" : "which", [name], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
test.skip(!hasTool("yt-dlp") || !hasTool("ffmpeg"), "needs yt-dlp and ffmpeg");

test("downloader saves the current song as a tagged mp3 from the player bar", async () => {
  test.setTimeout(150_000);
  const folder = mkdtempSync(join(tmpdir(), "pear-downloads-"));
  const app = await launchApp({
    plugins: {
      downloader: { enabled: true, config: { folder, format: "mp3", template: "%(title)s.%(ext)s" } },
      adblock: { enabled: true, config: { blockRequests: false } },
    },
  });
  let page: Page | undefined;
  try {
    page = await mainWindow(app);
    await expect
      .poll(() => invoke<{ capabilities: { ffmpeg: boolean } }>(page!, "downloader", "info").catch(() => null))
      .toMatchObject({ capabilities: { ffmpeg: true } });

    await playTestTrack(page);
    await page.evaluate(() => window.__pearRuntime!.player.control({ type: "pause" }));

    const button = page.locator("ytmusic-player-bar .pear-dl-button");
    await expect(button).toBeVisible({ timeout: 15_000 });
    await expect(button).toHaveAttribute("title", "Download");
    await button.click();

    // Progress shows on the button, then a toast confirms.
    await expect(button).toHaveAttribute("data-busy", /downloading|converting/, { timeout: 30_000 });
    const toast = page.locator(".pear-dl-toast");
    await expect(toast).toContainText("Saved", { timeout: 90_000 });
    await expect(toast.getByRole("button", { name: "Show" })).toBeVisible();
    await expect(button).not.toHaveAttribute("data-busy");

    const files = readdirSync(folder);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.mp3$/);
    const tags = JSON.parse(
      execFileSync("ffprobe", ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", join(folder, files[0]!)], {
        encoding: "utf8",
      }),
    ) as { format: { tags: Record<string, string> }; streams: { codec_type: string; width?: number; height?: number }[] };
    const title = await page.evaluate(() => window.__pearRuntime!.player.state.track!.title);
    expect(tags.format.tags.title).toContain(title);
    expect(tags.format.tags.artist).toBeTruthy();
    const cover = tags.streams.find((s) => s.codec_type === "video");
    expect(cover).toBeTruthy();
    expect(cover!.width).toBe(cover!.height);

    // A missing yt-dlp is reported in settings.
    await page.evaluate(() => window.__pear!.invoke("plugin:set-config", "downloader", { ytDlpPath: "/nonexistent/yt-dlp" }));
    await expect
      .poll(() => page!.evaluate(() => window.__pearRuntime!.plugins.error("downloader") ?? ""))
      .toMatch(/yt-dlp was not found/);
  } finally {
    await closeApp(app, page);
  }
});
