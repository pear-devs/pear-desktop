// Audio plugins with in-page controls: speed, quality, volume, output device, captions.

import { expect, test } from "@playwright/test";
import { closeApp, installAudioProbe, pluginConfig, setConfig, setEnabled, waitForTrackPlaying } from "./audio-helpers.ts";
import { launchApp, mainWindow, playTestTrack } from "./launch.ts";

test("playback-speed and quality-changer pickers drive the player", async () => {
  test.setTimeout(240_000);
  const app = await launchApp({ plugins: { "playback-speed": { enabled: true }, "quality-changer": { enabled: true } } });
  try {
    const page = await mainWindow(app);
    await playTestTrack(page);
    await waitForTrackPlaying(page);
    const rate = () => page.evaluate(() => document.querySelector("video")!.playbackRate);

    const speedButton = page.locator("ytmusic-player-bar .pear-speed-button");
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
    await page.evaluate(() => (document.querySelector("video")!.playbackRate = 1));
    await expect.poll(rate).toBe(0.8);
    await setEnabled(page, "playback-speed", false);
    await expect.poll(rate).toBe(1);
    await expect(speedButton).toHaveCount(0);

    // Quality: the picker lists YTM's levels and calls its quality API.
    await page.evaluate(() => {
      const api = document.querySelector("#movie_player") as HTMLElement & Record<string, (...args: unknown[]) => unknown>;
      const original = api.setPlaybackQualityRange!.bind(api);
      (window as unknown as { __qualityCalls: unknown[][] }).__qualityCalls = [];
      api.setPlaybackQualityRange = (...args: unknown[]) => {
        (window as unknown as { __qualityCalls: unknown[][] }).__qualityCalls.push(args);
        return original(...args);
      };
    });
    const qualityButton = page.locator("ytmusic-player .top-row-buttons .pear-quality-button");
    await expect(qualityButton).toHaveCount(1);
    await qualityButton.evaluate((button: HTMLElement) => button.click());
    const items = page.locator(".pear-quality-popover button");
    await expect(items.first()).toBeVisible();
    const levels = await items.evaluateAll((buttons) => buttons.map((b) => (b as HTMLElement).dataset.quality));
    expect(levels).toContain("auto");
    const target = levels.includes("tiny") ? "tiny" : levels[0]!;
    await page.locator(`.pear-quality-popover button[data-quality="${target}"]`).click();
    expect(await page.evaluate(() => (window as unknown as { __qualityCalls: unknown[][] }).__qualityCalls)).toContainEqual([target, target]);
    await expect(page.locator(".pear-quality-popover")).toBeHidden();

    await setEnabled(page, "quality-changer", false);
    await expect(qualityButton).toHaveCount(0);
  } finally {
    await closeApp(app);
  }
});

test("precise-volume steps finely by wheel and keys; exponential-volume reshapes the curve", async () => {
  test.setTimeout(240_000);
  const app = await launchApp({ plugins: { "precise-volume": { enabled: true, config: { steps: 2 } } } });
  try {
    const page = await mainWindow(app);
    await playTestTrack(page);
    await waitForTrackPlaying(page);
    // The slider position: YTM may map it through a loudness curve onto the player volume.
    const volume = () =>
      page.evaluate(() => Number(document.querySelector<HTMLElement & { value: number }>("ytmusic-player-bar #volume-slider")!.value));
    const start = await volume();
    const base = start > 90 ? start - 10 : start;

    // Wheel over YTM's own volume slider: the plugin's step wins over YTM's 5%.
    const wheel = (deltaY: number) =>
      page.evaluate((deltaY) => {
        const slider = document.querySelector("ytmusic-player-bar #volume-slider")!;
        slider.dispatchEvent(new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true, composed: true }));
      }, deltaY);
    if (base !== start) for (let i = 0; i < 5; i++) await wheel(100);
    await expect.poll(volume).toBe(base);
    await wheel(100);
    await expect.poll(volume).toBe(base - 2);
    await wheel(-100);
    await wheel(-100);
    await expect.poll(volume).toBe(base + 2);
    await expect(page.locator(".pear-volume-hud")).toHaveText(`${base + 2}%`);
    await expect.poll(() => page.locator("ytmusic-player-bar #volume-slider").getAttribute("title")).toBe(`${base + 2}%`);

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("ArrowDown");
    await expect.poll(volume).toBe(base);

    await setConfig(page, "precise-volume", { arrowsShortcut: false });
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(300);
    expect(await volume()).toBe(base);

    // Exponential volume: the player's volume v reaches the element as v³; reads stay v.
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
    await wheel(-100);
    await expect.poll(volume).toBe(base + 2);
    await expect.poll(element).toEqual({ cubed: true, linear: false, read: true });
    await setEnabled(page, "exponential-volume", false);
    await expect.poll(element).toMatchObject({ linear: true, read: true });
  } finally {
    await closeApp(app);
  }
});

test("custom-output-device routes the shared graph to the chosen device", async () => {
  test.setTimeout(180_000);
  const app = await launchApp();
  try {
    const page = await mainWindow(app);
    await playTestTrack(page);
    await installAudioProbe(page);
    await waitForTrackPlaying(page);
    const outputs = await page.evaluate(async () =>
      (await navigator.mediaDevices.enumerateDevices())
        .filter((d) => d.kind === "audiooutput" && d.deviceId !== "default")
        .map((d) => ({ id: d.deviceId, label: d.label })),
    );
    test.skip(outputs.length === 0, "no audio output devices besides the default");
    const device = outputs[0]!;

    await setEnabled(page, "custom-output-device", true);
    const button = page.locator("ytmusic-player-bar .pear-output-button");
    await expect
      .poll(() =>
        page.evaluate(() => ({
          button: !!document.querySelector("ytmusic-player-bar .pear-output-button"),
          anywhere: !!document.querySelector(".pear-output-button"),
          row: !!document.querySelector("ytmusic-player-bar #right-controls .right-controls-buttons"),
          enabled: window.__pearRuntime!.plugins.state("custom-output-device")?.enabled,
          error: window.__pearRuntime!.plugins.error("custom-output-device") ?? null,
        })),
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
    expect((await pluginConfig(page, "custom-output-device"))?.device).toBe(device.label);

    await setConfig(page, "custom-output-device", { device: "" });
    await expect.poll(sinks).toEqual({ context: "" });
    await setConfig(page, "custom-output-device", { device: device.label });
    await expect.poll(sinks).toEqual({ context: device.id });
    await setEnabled(page, "custom-output-device", false);
    await expect.poll(sinks).toEqual({ context: "" });
    await expect(button).toHaveCount(0);
  } finally {
    await closeApp(app);
  }
});
