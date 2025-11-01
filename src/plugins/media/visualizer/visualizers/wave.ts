import { Wave } from '@foobar404/wave';

import { Visualizer } from './visualizer';

import type { VisualizerPluginConfig } from '../index';

class WaveVisualizer extends Visualizer<Wave> {
  name = 'wave';

  visualizer: Wave;

  constructor(
    audioContext: AudioContext,
    audioSource: MediaElementAudioSourceNode,
    visualizerContainer: HTMLElement,
    canvas: HTMLCanvasElement,
    audioNode: GainNode,
    stream: MediaStream,
    options: VisualizerPluginConfig,
  ) {
    super(
      audioContext,
      audioSource,
      visualizerContainer,
      canvas,
      audioNode,
      stream,
      options,
    );

    this.visualizer = new Wave(
      { context: audioContext, source: audioSource },
      canvas,
    );
    for (const animation of options.wave.animations) {
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

  render() {}
}

export default WaveVisualizer;
