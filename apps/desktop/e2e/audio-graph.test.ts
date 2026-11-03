// Audio plugins that process the shared Web Audio graph.

import { expect, test } from "./fixtures.ts";
import { audioChain, installAudioProbe, litPixels, outputLevel } from "./helpers/audio.ts";
import { waitForTrackPlaying } from "./helpers/playback.ts";
import { pluginConfig, setConfig, setEnabled } from "./helpers/plugins.ts";
import { mainWindow, playTestTrack } from "./launch.ts";

/** The visualizers draw at least this many of the sampled pixels. */
const PAINTED = 100;

test("equalizer, compressor and crossfade compose in the shared graph and toggle live", async ({ page }) => {
  test.setTimeout(240_000);
  await playTestTrack(page);
  await installAudioProbe(page);
  await waitForTrackPlaying(page);

  await setEnabled(page, "crossfade", true);
  await setEnabled(page, "audio-compressor", true);
  await setEnabled(page, "equalizer", true);
  // Ordered by stage order, not by enable order.
  const expected = ["GainNode", ...Array(10).fill("BiquadFilterNode"), "GainNode", "DynamicsCompressorNode", "GainNode"];
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
  await expect.poll(async () => (await pluginConfig(page, "equalizer"))?.band32).toBe(12);

  // Moving a band switches the preset to custom.
  await setConfig(page, "equalizer", { band1000: -6 });
  await expect.poll(async () => (await pluginConfig(page, "equalizer"))?.preset).toBe("custom");

  // Extra filters (pear-desktop's format) are added on top of the signal, as pear-desktop
  // mixed them: the bands feed both the mix and each filter, which feeds the mix too.
  await setConfig(page, "equalizer", { filters: '[{"type":"lowshelf","frequency":80,"Q":100,"gain":12}]' });
  const extraWiring = () =>
    page.evaluate(() => {
      const edges = window.__audioProbe!.edges;
      const extra = [...edges.keys()].find((n): n is BiquadFilterNode => n instanceof BiquadFilterNode && n.frequency.value === 80);
      if (!extra) return null;
      const feeders = [...edges].filter(([, targets]) => targets.has(extra)).map(([node]) => node);
      const mix = [...(edges.get(extra) ?? [])][0];
      return { fedByBand: feeders.length === 1 && feeders[0] instanceof BiquadFilterNode, mixAlsoDry: !!mix && edges.get(feeders[0]!)?.has(mix as AudioNode) };
    });
  await expect.poll(extraWiring).toEqual({ fedByBand: true, mixAlsoDry: true });
  await expect.poll(() => audioChain(page)).toEqual(expected);

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
});

test("crossfade plays the end of a track over the start of the next, as pear-desktop", async ({ launch }) => {
  test.setTimeout(300_000);
  const app = await launch({
    plugins: { crossfade: { enabled: false, config: { fadeOutDuration: 3000, fadeInDuration: 2000, secondsBeforeEnd: 5 } } },
  });
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
  // The second stream is a plain audio element; note the ones that play.
  await page.evaluate(() => {
    const streams: HTMLMediaElement[] = [];
    window.__streams = streams;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      if (this instanceof HTMLAudioElement) streams.push(this);
      return play.call(this);
    };
  });

  const firstId = await page.evaluate(() => window.__pearRuntime!.player.state.track!.videoId);
  const duration = await page.evaluate(() => document.querySelector("video")!.duration);
  // Shortly before the switch point (5 s before the end): the second stream loads meanwhile.
  await page.evaluate((t) => window.__pearRuntime!.player.control({ type: "seek", seconds: t }), duration - 12);

  // At the switch the next track starts while the end of this one keeps playing, fading out.
  await expect
    .poll(() => page.evaluate(() => window.__pearRuntime!.player.state.track?.videoId), { timeout: 30_000 })
    .not.toBe(firstId);
  const overlap = () =>
    page.evaluate(() => {
      const stream = window.__streams!.at(-1);
      return { outgoing: !!stream && !stream.paused, volume: stream?.volume ?? 0, next: window.__pearRuntime!.player.state.status };
    });
  await expect.poll(async () => (await overlap()).outgoing, { timeout: 10_000 }).toBe(true);
  await waitForTrackPlaying(page);
  // Both at once, the outgoing one fading.
  const during = await overlap();
  expect(during.next).toBe("playing");
  expect(during.outgoing).toBe(true);
  expect(during.volume).toBeLessThan(1);
  // The fade-out ends the second stream; the next track is at full volume.
  await expect.poll(async () => (await overlap()).outgoing, { timeout: 10_000 }).toBe(false);
  await expect.poll(fadeGain, { timeout: 20_000 }).toBeGreaterThan(0.99);
});

test("skip-silences jumps over silence and visualizer draws from a graph tap", async ({ launch }) => {
  test.setTimeout(240_000);
  const app = await launch({ plugins: { visualizer: { enabled: false, config: { type: "vudio" } } } });
  const page = await mainWindow(app);
  await playTestTrack(page);
  await installAudioProbe(page);
  await waitForTrackPlaying(page);

  await setEnabled(page, "visualizer", true);
  const painted = () => litPixels(page, "alpha");
  // pear-desktop's Vudio, then Wave with its default animations.
  await expect.poll(painted, { timeout: 15_000 }).toBeGreaterThan(PAINTED);
  await setConfig(page, "visualizer", { type: "wave" });
  await expect.poll(painted, { timeout: 15_000 }).toBeGreaterThan(PAINTED);
  // Their own analysers reach the speakers only through a muted gain: the track isn't doubled.
  const audible = () =>
    page.evaluate(() => {
      const probe = window.__audioProbe!;
      const destination = probe.context!.destination;
      return [...probe.edges]
        .filter(([, targets]) => targets.has(destination))
        .filter(([node]) => !(node instanceof GainNode && node.gain.value === 0)).length;
    });
  expect(await audible()).toBe(1);

  // Milkdrop loads lazily from the host and renders through WebGL into the same spot.
  await setConfig(page, "visualizer", { type: "butterchurn" });
  const butterchurn = () => litPixels(page, "color");
  await expect.poll(butterchurn, { timeout: 30_000 }).toBeGreaterThan(PAINTED);
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
});
