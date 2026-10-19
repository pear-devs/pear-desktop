// Audio plugins that process the shared Web Audio graph.

import { expect, test } from "@playwright/test";
import { audioChain, closeApp, installAudioProbe, outputLevel, setConfig, setEnabled, waitForTrackPlaying } from "./audio-helpers.ts";
import { launchApp, mainWindow, playTestTrack } from "./launch.ts";

test("equalizer, compressor and crossfade compose in the shared graph and toggle live", async () => {
  test.setTimeout(240_000);
  const app = await launchApp();
  try {
    const page = await mainWindow(app);
    await playTestTrack(page);
    await installAudioProbe(page);
    await waitForTrackPlaying(page);

    await setEnabled(page, "crossfade", true);
    await setEnabled(page, "audio-compressor", true);
    await setEnabled(page, "equalizer", true);
    // Ordered by stage order, not by enable order.
    const expected = ["GainNode", ...Array(10).fill("BiquadFilterNode"), "DynamicsCompressorNode", "GainNode"];
    await expect.poll(() => audioChain(page), { timeout: 15_000 }).toEqual(expected);
    await expect.poll(() => outputLevel(page), { timeout: 15_000 }).toBeGreaterThan(0.005);

    // Choosing a preset moves the bands (live, without rebuilding the chain).
    await setConfig(page, "equalizer", { preset: "bass-booster" });
    const bandGains = () =>
      page.evaluate(() => {
        const probe = window.__audioProbe!;
        return [...probe.edges.keys()].filter((n): n is BiquadFilterNode => n instanceof BiquadFilterNode).map((n) => Math.round(n.gain.value));
      });
    await expect.poll(bandGains).toEqual([12, 10, 7, 3, 0, 0, 0, 0, 0, 0]);
    await expect.poll(() => page.evaluate(() => window.__pearRuntime!.plugins.state("equalizer")?.config.band32)).toBe(12);

    // Moving a band switches the preset to custom.
    await setConfig(page, "equalizer", { band1000: -6 });
    await expect.poll(() => page.evaluate(() => window.__pearRuntime!.plugins.state("equalizer")?.config.preset)).toBe("custom");

    // Extra filters from JSON extend the chain.
    await setConfig(page, "equalizer", { filters: '[{"type":"notch","frequency":440,"Q":5,"gain":0}]' });
    await expect.poll(() => audioChain(page)).toEqual(["GainNode", ...Array(11).fill("BiquadFilterNode"), "DynamicsCompressorNode", "GainNode"]);

    // The compressor is actually compressing and follows its config.
    const compressor = () =>
      page.evaluate(() => {
        const node = [...window.__audioProbe!.edges.keys()].find((n): n is DynamicsCompressorNode => n instanceof DynamicsCompressorNode);
        return node && { threshold: node.threshold.value, reduction: node.reduction };
      });
    await expect.poll(async () => (await compressor())?.reduction ?? 0, { timeout: 10_000 }).toBeLessThan(-1);
    await setConfig(page, "audio-compressor", { threshold: -20 });
    await expect.poll(async () => (await compressor())?.threshold).toBe(-20);

    await setEnabled(page, "equalizer", false);
    await expect.poll(() => audioChain(page)).toEqual(["DynamicsCompressorNode", "GainNode"]);
    await setEnabled(page, "audio-compressor", false);
    await setEnabled(page, "crossfade", false);
    await expect.poll(() => audioChain(page)).toEqual([]);
    await expect.poll(() => outputLevel(page)).toBeGreaterThan(0.005);
  } finally {
    await closeApp(app);
  }
});

test("crossfade fades the end of a track out and the next one in", async () => {
  test.setTimeout(300_000);
  const app = await launchApp({
    plugins: { crossfade: { enabled: false, config: { fadeOutDuration: 3000, fadeInDuration: 2000, secondsBeforeEnd: 5 } } },
  });
  try {
    const page = await mainWindow(app);
    await playTestTrack(page);
    await installAudioProbe(page);
    await waitForTrackPlaying(page);
    await setEnabled(page, "crossfade", true);
    const fadeGain = () =>
      page.evaluate(() => {
        const probe = window.__audioProbe!;
        const node = [...(probe.edges.get(probe.source!) ?? [])][0];
        return node instanceof GainNode ? node.gain.value : null;
      });
    await expect.poll(fadeGain, { timeout: 20_000 }).toBeGreaterThan(0.99);

    const firstId = await page.evaluate(() => window.__pearRuntime!.player.state.track!.videoId);
    const duration = await page.evaluate(() => document.querySelector("video")!.duration);
    // Into the fade-out window: it ends 5 s before the end and lasts 3 s.
    await page.evaluate((t) => window.__pearRuntime!.player.control({ type: "seek", seconds: t }), duration - 7);
    await expect.poll(fadeGain, { timeout: 10_000 }).toBeLessThan(0.6);

    // At the skip point the next track starts and fades in.
    await expect
      .poll(() => page.evaluate(() => window.__pearRuntime!.player.state.track?.videoId), { timeout: 30_000 })
      .not.toBe(firstId);
    await waitForTrackPlaying(page);
    await expect.poll(fadeGain, { timeout: 20_000 }).toBeGreaterThan(0.99);
  } finally {
    await closeApp(app);
  }
});

test("skip-silences jumps over silence and visualizer draws from a graph tap", async () => {
  test.setTimeout(240_000);
  const app = await launchApp({ plugins: { visualizer: { enabled: false, config: { type: "bars" } } } });
  try {
    const page = await mainWindow(app);
    await playTestTrack(page);
    await installAudioProbe(page);
    await waitForTrackPlaying(page);

    await setEnabled(page, "visualizer", true);
    const painted = () =>
      page.evaluate(() => {
        const canvas = document.querySelector<HTMLCanvasElement>("ytmusic-player#player canvas.pear-visualizer");
        if (!canvas || canvas.width === 0) return 0;
        const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
        let lit = 0;
        for (let i = 3; i < pixels.length; i += 16) if (pixels[i]! > 0) lit++;
        return lit;
      });
    await expect.poll(painted, { timeout: 15_000 }).toBeGreaterThan(100);

    // Milkdrop loads lazily from the host and renders through WebGL into the same spot.
    await setConfig(page, "visualizer", { type: "butterchurn" });
    const butterchurn = () =>
      page.evaluate(() => {
        const canvas = document.querySelector<HTMLCanvasElement>("ytmusic-player#player canvas.pear-visualizer");
        if (!canvas || canvas.width === 0) return 0;
        const g = canvas.getContext("2d")!;
        const pixels = g.getImageData(0, 0, canvas.width, canvas.height).data;
        let lit = 0;
        for (let i = 0; i < pixels.length; i += 16) if (pixels[i]! + pixels[i + 1]! + pixels[i + 2]! > 30) lit++;
        return lit;
      });
    await expect.poll(butterchurn, { timeout: 30_000 }).toBeGreaterThan(100);
    await setEnabled(page, "visualizer", false);
    await expect.poll(() => page.evaluate(() => document.querySelectorAll("canvas.pear-visualizer").length)).toBe(0);

    await setEnabled(page, "skip-silences", true);
    await expect.poll(() => audioChain(page)).toEqual(["GainNode", "GainNode"]);
    // Near-silent playback: the plugin keeps stepping forward faster than real time.
    const start = await page.evaluate(() => {
      const video = document.querySelector("video")!;
      video.volume = 1e-7;
      return video.currentTime;
    });
    await page.waitForTimeout(3000);
    const advanced = await page.evaluate((start) => document.querySelector("video")!.currentTime - start, start);
    expect(advanced).toBeGreaterThan(6);

    await setEnabled(page, "skip-silences", false);
    await expect.poll(() => audioChain(page)).toEqual([]);
  } finally {
    await closeApp(app);
  }
});
