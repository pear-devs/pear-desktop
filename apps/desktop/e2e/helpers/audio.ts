// The shared Web Audio graph, observed from the page.

import type { Page } from "@playwright/test";

declare global {
  interface Window {
    __audioProbe?: AudioProbe;
  }
}

interface AudioProbe {
  context?: AudioContext;
  source?: MediaElementAudioSourceNode;
  edges: Map<AudioNode, Set<AudioNode | AudioParam>>;
}

/**
 * Records the shared graph's context and connections. Call before enabling the
 * first audio plugin: the graph is created lazily by the first `ctx.audio()`.
 */
export async function installAudioProbe(page: Page) {
  await page.evaluate(() => {
    if (window.__audioProbe) return;
    const probe: AudioProbe = { edges: new Map() };
    window.__audioProbe = probe;
    const connect = AudioNode.prototype.connect;
    const disconnect = AudioNode.prototype.disconnect;
    AudioNode.prototype.connect = function (this: AudioNode, target: AudioNode | AudioParam, ...rest: number[]) {
      let set = probe.edges.get(this);
      if (!set) probe.edges.set(this, (set = new Set()));
      set.add(target);
      return (connect as (...args: unknown[]) => AudioNode).call(this, target, ...rest);
    } as typeof connect;
    AudioNode.prototype.disconnect = function (this: AudioNode, ...args: unknown[]) {
      const target = args[0];
      if (target instanceof AudioNode || target instanceof AudioParam) probe.edges.get(this)?.delete(target);
      else probe.edges.delete(this);
      return (disconnect as (...args: unknown[]) => void).apply(this, args);
    } as typeof disconnect;
    const create = AudioContext.prototype.createMediaElementSource;
    AudioContext.prototype.createMediaElementSource = function (this: AudioContext, element: HTMLMediaElement) {
      const source = create.call(this, element);
      probe.context = this;
      probe.source = source;
      return source;
    };
  });
}

/** Constructor names along the main chain, source → destination (taps excluded). */
export function audioChain(page: Page) {
  return page.evaluate(() => {
    const probe = window.__audioProbe;
    if (!probe?.source || !probe.context) return null;
    const names: string[] = [];
    let node: AudioNode = probe.source;
    for (let i = 0; i < 50; i++) {
      const targets = [...(probe.edges.get(node) ?? [])].filter((t): t is AudioNode => t instanceof AudioNode);
      if (targets.includes(probe.context.destination)) return names;
      // A stage's own side branches (analysers) are not part of the chain.
      const next = targets.find((t) => !(t instanceof AnalyserNode));
      if (!next) return names;
      names.push(next.constructor.name);
      node = next;
    }
    return names;
  });
}

/** RMS level of the graph's final output, sampled for a moment through a fresh analyser. */
export function outputLevel(page: Page) {
  return page.evaluate(async () => {
    const probe = window.__audioProbe!;
    const context = probe.context!;
    const last = [...probe.edges].find(([, targets]) => targets.has(context.destination))?.[0];
    if (!last) return 0;
    const analyser = context.createAnalyser();
    last.connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    let peak = 0;
    for (let i = 0; i < 10; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      analyser.getFloatTimeDomainData(data);
      peak = Math.max(peak, Math.sqrt(data.reduce((sum, v) => sum + v * v, 0) / data.length));
    }
    last.disconnect(analyser);
    return peak;
  });
}

/**
 * How many sampled pixels of the visualizer's canvas are lit (every 4th pixel):
 * by alpha for 2D drawings, by color for WebGL (opaque black when dark).
 */
export function litPixels(page: Page, by: "alpha" | "color") {
  return page.evaluate((by) => {
    const canvas = document.querySelector<HTMLCanvasElement>("ytmusic-player#player canvas.pear-visualizer");
    if (!canvas || canvas.width === 0) return 0;
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let lit = 0;
    for (let i = 0; i < pixels.length; i += 16) {
      const on = by === "alpha" ? pixels[i + 3]! > 0 : pixels[i]! + pixels[i + 1]! + pixels[i + 2]! > 30;
      if (on) lit++;
    }
    return lit;
  }, by);
}
