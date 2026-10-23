// Audio plugins with in-page controls: speed, quality, volume, output device.

import { expect, test } from "./fixtures.ts";
import { installAudioProbe } from "./helpers/audio.ts";
import { waitForTrackPlaying } from "./helpers/playback.ts";
import { pluginConfig, setConfig, setEnabled } from "./helpers/plugins.ts";
import { recordCalls } from "./helpers/probes.ts";
import { playTestTrack } from "./launch.ts";
import type { Page } from "@playwright/test";
import { inBar, sel } from "./helpers/player-bar.ts";

const PLAYING_TEST_MS = 240_000;

test.describe("pickers", () => {
  test.use({ appOptions: { plugins: { "playback-speed": { enabled: true }, "quality-changer": { enabled: true } } } });

  test("playback-speed's picker drives the player", async ({ page }) => {
    test.setTimeout(PLAYING_TEST_MS);
    await playTestTrack(page);
    await waitForTrackPlaying(page);
    const rate = () => page.evaluate(() => document.querySelector("video")!.playbackRate);

    const speedButton = page.locator(inBar(".pear-speed-button"));
    await expect(speedButton).toHaveText("1×");
    await speedButton.click();
    await page.locator(".pear-speed-popover button", { hasText: "1.5×" }).click();
    await expect.poll(rate).toBe(1.5);
    await expect.poll(async () => (await pluginConfig(page, "playback-speed"))?.speed).toBe(1.5);

    // Fine steps with the wheel.
    await page.locator(".pear-speed-popover input").hover();
    await page.mouse.wheel(0, -100);
    await page.mouse.wheel(0, -100);
    await expect.poll(rate).toBe(1.52);
    await page.keyboard.press("Escape");
    await expect(speedButton).toHaveText("1.52×");

    // Settings and YTM's own rate resets are followed.
    await setConfig(page, "playback-speed", { speed: 0.8 });
    await expect.poll(rate).toBe(0.8);
    await page.evaluate(() => {
      document.querySelector("video")!.playbackRate = 1;
    });
    await expect.poll(rate).toBe(0.8);
    await setEnabled(page, "playback-speed", false);
    await expect.poll(rate).toBe(1);
    await expect(speedButton).toHaveCount(0);
  });

  test("quality-changer's picker lists YTM's levels and calls its quality API", async ({ page }) => {
    test.setTimeout(PLAYING_TEST_MS);
    await playTestTrack(page);
    await waitForTrackPlaying(page);
    const calls = await recordCalls(page, "#movie_player", ["setPlaybackQualityRange"], "quality");
    const qualityButton = page.locator("ytmusic-player .top-row-buttons .pear-quality-button");
    await expect(qualityButton).toHaveCount(1);
    await qualityButton.evaluate((button: HTMLElement) => button.click());
    const items = page.locator(".pear-quality-popover button");
    await expect(items.first()).toBeVisible();
    const levels = await items.evaluateAll((buttons) => buttons.map((b) => (b as HTMLElement).dataset.quality));
    expect(levels).toContain("auto");
    const target = levels.includes("tiny") ? "tiny" : levels[0]!;
    await page.locator(`.pear-quality-popover button[data-quality="${target}"]`).click();
    expect(await calls()).toContainEqual(["setPlaybackQualityRange", target, target]);
    await expect(page.locator(".pear-quality-popover")).toBeHidden();

    await setEnabled(page, "quality-changer", false);
    await expect(qualityButton).toHaveCount(0);
  });
});

// The slider position: YTM may map it through a loudness curve onto the player volume.
const sliderVolume = (page: Page) =>
  page.evaluate(
    (slider) => Number(document.querySelector<HTMLElement & { value: number | string }>(slider)!.value),
    sel("player_bar.volume_slider"),
  );

/** A wheel turn over YTM's own volume slider. */
const wheel = (page: Page, deltaY: number) =>
  page.evaluate(
    ([deltaY, selector]) => {
      const slider = document.querySelector(selector)!;
      slider.dispatchEvent(new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true, composed: true }));
    },
    [deltaY, sel("player_bar.volume_slider")] as const,
  );

/** A volume with room for steps up: the current one, or 10 below it near the top. */
async function startVolume(page: Page) {
  const start = await sliderVolume(page);
  const base = start > 90 ? start - 10 : start;
  if (base !== start) for (let i = 0; i < 5; i++) await wheel(page, 100);
  await expect.poll(() => sliderVolume(page)).toBe(base);
  return base;
}

test.describe("volume", () => {
  test.use({ appOptions: { plugins: { "precise-volume": { enabled: true, config: { steps: 2 } } } } });

  test("precise-volume steps finely by wheel and keys", async ({ page }) => {
    test.setTimeout(PLAYING_TEST_MS);
    await playTestTrack(page);
    await waitForTrackPlaying(page);
    const volume = () => sliderVolume(page);
    const base = await startVolume(page);

    // The plugin's step wins over YTM's 5%.
    await wheel(page, 100);
    await expect.poll(volume).toBe(base - 2);
    await wheel(page, -100);
    await wheel(page, -100);
    await expect.poll(volume).toBe(base + 2);
    await expect(page.locator(".pear-volume-hud")).toHaveText(`${base + 2}%`);
    await expect.poll(() => page.locator(sel("player_bar.volume_slider")).getAttribute("title")).toBe(`${base + 2}%`);

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("ArrowDown");
    await expect.poll(volume).toBe(base);

    await setConfig(page, "precise-volume", { arrowsShortcut: false });
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(300);
    expect(await volume()).toBe(base);
  });

  test("exponential-volume reshapes the curve, also for precise-volume's steps", async ({ page }) => {
    test.setTimeout(PLAYING_TEST_MS);
    await playTestTrack(page);
    await waitForTrackPlaying(page);
    const base = await startVolume(page);

    // The player's volume v reaches the element as v³; reads stay v.
    const element = () =>
      page.evaluate(() => {
        const video = document.querySelector("video")!;
        const api = document.querySelector("#movie_player") as HTMLElement & { getVolume(): number };
        const native = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "volume")!.get!.call(video) as number;
        const v = api.getVolume() / 100;
        return { cubed: Math.abs(native - v ** 3) < 0.002, linear: Math.abs(native - v) < 0.002, read: Math.abs(video.volume - v) < 0.002 };
      });
    expect(await element()).toMatchObject({ linear: true, read: true });
    await setEnabled(page, "exponential-volume", true);
    await expect.poll(element).toEqual({ cubed: true, linear: false, read: true });
    // Changes made while it is on go through the curve too.
    await wheel(page, -100);
    await expect.poll(() => sliderVolume(page)).toBe(base + 2);
    await expect.poll(element).toEqual({ cubed: true, linear: false, read: true });
    await setEnabled(page, "exponential-volume", false);
    await expect.poll(element).toMatchObject({ linear: true, read: true });
  });
});

/** The audio outputs besides the default one. */
const audioOutputs = (page: Page) =>
  page.evaluate(async () =>
    (await navigator.mediaDevices.enumerateDevices())
      .filter((d) => d.kind === "audiooutput" && d.deviceId !== "default")
      .map((d) => ({ id: d.deviceId, label: d.label })),
  );

test("custom-output-device routes the shared graph to the chosen device", async ({ page }) => {
  test.setTimeout(180_000);
  await playTestTrack(page);
  await installAudioProbe(page);
  await waitForTrackPlaying(page);
  const outputs = await audioOutputs(page);
  test.skip(outputs.length === 0, "no audio output devices besides the default");
  const device = outputs[0]!;

  await setEnabled(page, "custom-output-device", true);
  const button = page.locator(inBar(".pear-output-button"));
  await expect
    .poll(() =>
      page.evaluate(([button, row]) => ({
        button: !!document.querySelector(button),
        anywhere: !!document.querySelector(".pear-output-button"),
        row: !!document.querySelector(row),
        enabled: window.__pearRuntime!.plugins.state("custom-output-device")?.enabled,
        error: window.__pearRuntime!.plugins.error("custom-output-device") ?? null,
      }), [inBar(".pear-output-button"), sel("player_bar.right_controls_buttons")] as const),
    )
    .toMatchObject({ button: true });
  await button.click();
  const items = page.locator(".pear-output-popover button");
  await expect(items.first()).toHaveText("System default");
  await expect(items).toHaveCount(outputs.length + 1);
  await items.nth(1).click();

  const sinks = () =>
    page.evaluate(() => ({ context: (window.__audioProbe!.context as (AudioContext & { sinkId: string }) | undefined)?.sinkId }));
  await expect.poll(sinks).toEqual({ context: device.id });
  expect((await pluginConfig(page, "custom-output-device"))?.output).toBe(device.label);

  await setConfig(page, "custom-output-device", { output: "" });
  await expect.poll(sinks).toEqual({ context: "" });
  await setConfig(page, "custom-output-device", { output: device.label });
  await expect.poll(sinks).toEqual({ context: device.id });
  await setEnabled(page, "custom-output-device", false);
  await expect.poll(sinks).toEqual({ context: "" });
  await expect(button).toHaveCount(0);
});
