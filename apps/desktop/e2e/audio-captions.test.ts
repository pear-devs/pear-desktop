import { expect, test } from "./fixtures.ts";
import { waitForTrackPlaying } from "./helpers/playback.ts";
import { pluginConfig, setConfig, setEnabled } from "./helpers/plugins.ts";
import { recordCalls } from "./helpers/probes.ts";
import { playTestTrack } from "./launch.ts";
import { inBar } from "./helpers/player-bar.ts";

test("captions-selector lists caption tracks and switches them through the player API", async ({ page }) => {
  test.setTimeout(180_000);
  await playTestTrack(page);
  await waitForTrackPlaying(page);
  // Logged-out test tracks rarely carry captions; give the captions module a known track list.
  const calls = await recordCalls(page, "#movie_player", ["loadModule", "unloadModule"], "captions");
  await page.evaluate(() => {
    const api = document.querySelector("#movie_player") as HTMLElement & Record<string, (...args: unknown[]) => unknown>;
    const recorded = window.__pearCalls!.captions!;
    let track: unknown = {};
    const getOption = api.getOption!.bind(api);
    api.getOption = (module, option) => {
      if (module !== "captions") return getOption(module, option);
      if (option === "tracklist") {
        return [
          { languageCode: "en", displayName: "English" },
          { languageCode: "de", displayName: "German" },
        ];
      }
      return track;
    };
    api.setOption = (module, option, value) => {
      recorded.push(["setOption", module, option, value]);
      if (option === "track") track = value;
    };
  });

  await setEnabled(page, "captions-selector", true);
  const button = page.locator(inBar(".pear-captions-button"));
  await expect(button).toBeVisible({ timeout: 15_000 });
  expect(await calls()).toContainEqual(["loadModule", "captions"]);
  await button.click();
  const items = page.locator(".pear-captions-popover button");
  await expect(items).toHaveText(["None", "English", "German"]);
  await items.nth(2).click();
  expect(await calls()).toContainEqual(["setOption", "captions", "track", { languageCode: "de" }]);
  await expect.poll(async () => (await pluginConfig(page, "captions-selector"))?.lastCaptionsCode).toBe("de");
  // Confirmed in YTM's own toast, as pear-desktop does.
  await expect(page.getByText("Caption changed to German")).toBeVisible();
  await button.click();
  await expect(items.nth(2)).toHaveAttribute("aria-checked", "true");
  await items.first().click();
  expect(await calls()).toContainEqual(["setOption", "captions", "track", {}]);
  await expect(page.getByText("Captions disabled")).toBeVisible();
  // None forgets the language, so autoload doesn't bring captions back on the next track.
  await expect.poll(async () => (await pluginConfig(page, "captions-selector"))?.lastCaptionsCode).toBe("");

  await setConfig(page, "captions-selector", { disableCaptions: true });
  await expect.poll(async () => (await calls()).some((c) => c[0] === "unloadModule")).toBe(true);
  await expect(button).toBeHidden();
  await setEnabled(page, "captions-selector", false);
  await expect(button).toHaveCount(0);
});
