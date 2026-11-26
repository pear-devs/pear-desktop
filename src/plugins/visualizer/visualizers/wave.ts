import { Wave } from '@foobar404/wave';

import { Visualizer } from './visualizer';

import type { VisualizerPluginConfig } from '../index';

class WaveVisualizer extends Visualizer {
  private readonly visualizer: Wave;

  constructor(
    audioContext: AudioContext,
    audioSource: AudioNode,
    canvas: HTMLCanvasElement,
    audioNode: GainNode,
    _stream: MediaStream,
    config: VisualizerPluginConfig,
  ) {
    super(audioSource, audioNode);

    this.visualizer = new Wave(
      {
        context: audioContext,
        // Wave only calls .connect() on it, so any AudioNode works
        source: audioSource as MediaElementAudioSourceNode,
      },
      canvas,
    );
    for (const animation of config.wave.animations) {
      const TargetVisualizer =
        this.visualizer.animations[
          animation.type as keyof typeof this.visualizer.animations
        ];

      this.visualizer.addAnimation(
        new TargetVisualizer(animation.config as never), // Magic of Typescript
      );
    }
  }

  resize(_: number, __: number) {}

  destroy() {
    this.visualizer.clearAnimations();
    try {
      this.audioSource.disconnect(this.audioNode);
    } catch {}
  }
}

export default WaveVisualizer;
