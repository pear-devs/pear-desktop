import Butterchurn from 'butterchurn';
import ButterchurnPresets from 'butterchurn-presets';

import { Visualizer } from './visualizer';

import type { VisualizerPluginConfig } from '../index';

class ButterchurnVisualizer extends Visualizer {
  private readonly visualizer: ReturnType<typeof Butterchurn.createVisualizer>;
  private destroyed: boolean = false;
  private animFrameHandle: number | null;

  constructor(
    audioContext: AudioContext,
    audioSource: MediaElementAudioSourceNode,
    canvas: HTMLCanvasElement,
    audioNode: GainNode,
    _stream: MediaStream,
    config: VisualizerPluginConfig,
  ) {
    super(audioSource, audioNode);

    const preset = ButterchurnPresets[config.butterchurn.preset];
    const renderVisualizer = () => {
      if (this.destroyed) return;
      this.visualizer.render();
      this.animFrameHandle = requestAnimationFrame(renderVisualizer);
    };

    this.visualizer = Butterchurn.createVisualizer(audioContext, canvas, {
      width: canvas.width,
      height: canvas.height,
    });
    this.visualizer.loadPreset(preset, config.butterchurn.blendTimeInSeconds);
    this.visualizer.connectAudio(audioNode);

    // Start animation request loop. Do not use setInterval!
    this.animFrameHandle = requestAnimationFrame(renderVisualizer);
  }

  resize(width: number, height: number) {
    this.visualizer.setRendererSize(width, height);
  }

  destroy() {
    if (this.animFrameHandle) cancelAnimationFrame(this.animFrameHandle);
    this.destroyed = true;
    try {
      this.audioSource.disconnect(this.audioNode);
    } catch {}
  }
}

export default ButterchurnVisualizer;
