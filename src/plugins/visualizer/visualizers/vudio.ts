import Vudio from 'vudio/umd/vudio';

import { Visualizer } from './visualizer';

import type { VisualizerPluginConfig } from '../index';

class VudioVisualizer extends Visualizer {
  private readonly visualizer: Vudio;
  private readonly onVisibilityChange: () => void;

  constructor(
    _audioContext: AudioContext,
    audioSource: MediaElementAudioSourceNode,
    canvas: HTMLCanvasElement,
    audioNode: GainNode,
    stream: MediaStream,
    config: VisualizerPluginConfig,
  ) {
    super(audioSource, audioNode);

    this.visualizer = new Vudio(stream, canvas, {
      width: canvas.width,
      height: canvas.height,
      // Visualizer config
      ...config,
    });

    this.onVisibilityChange = () => {
      if (document.hidden) {
        this.visualizer.pause();
      } else {
        this.visualizer.dance();
      }
    };
    document.addEventListener('visibilitychange', this.onVisibilityChange);

    this.visualizer.dance();
  }

  resize(width: number, height: number) {
    this.visualizer.setOption({
      width,
      height,
    });
  }

  destroy() {
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.visualizer.pause();
    try {
      this.audioSource.disconnect(this.audioNode);
    } catch {}
  }
}

export default VudioVisualizer;
