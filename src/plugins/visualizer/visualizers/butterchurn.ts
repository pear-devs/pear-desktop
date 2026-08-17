import Butterchurn from 'butterchurn';
import ButterchurnPresets from 'butterchurn-presets';

import { Visualizer } from './visualizer';

import type { VisualizerPluginConfig } from '../index';

class ButterchurnVisualizer extends Visualizer {
  private readonly visualizer: ReturnType<typeof Butterchurn.createVisualizer>;
  private destroyed: boolean = false;
  private animFrameHandle: number | null;
  private readonly onVisibilityChange: () => void;

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
      if (document.hidden) {
        this.animFrameHandle = null;
        return;
      }
      this.visualizer.render();
      this.animFrameHandle = requestAnimationFrame(renderVisualizer);
    };

    this.visualizer = Butterchurn.createVisualizer(audioContext, canvas, {
      width: canvas.width,
      height: canvas.height,
    });
    this.visualizer.loadPreset(preset, config.butterchurn.blendTimeInSeconds);
    this.visualizer.connectAudio(audioNode);

    this.onVisibilityChange = () => {
      if (this.destroyed || document.hidden || this.animFrameHandle != null) {
        return;
      }
      this.animFrameHandle = requestAnimationFrame(renderVisualizer);
    };
    document.addEventListener('visibilitychange', this.onVisibilityChange);

    // Start animation request loop. Do not use setInterval!
    this.animFrameHandle = requestAnimationFrame(renderVisualizer);
  }

  resize(width: number, height: number) {
    this.visualizer.setRendererSize(width, height);
  }

  destroy() {
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    if (this.animFrameHandle) cancelAnimationFrame(this.animFrameHandle);
    this.destroyed = true;
    try {
      this.audioSource.disconnect(this.audioNode);
    } catch {}
  }
}

export default ButterchurnVisualizer;
