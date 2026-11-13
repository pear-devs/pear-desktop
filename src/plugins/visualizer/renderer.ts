import { createRenderer } from '@/utils';

import {
  ButterchurnVisualizer as butterchurn,
  VudioVisualizer as vudio,
  WaveVisualizer as wave,
} from './visualizers';
import { type Visualizer } from './visualizers/visualizer';

import type { VisualizerPluginConfig, visualizerConfig } from './types';

export default createRenderer<typeof visualizerConfig>((ctx) => {
  let visualizerInstance: Visualizer | null = null;
  let audioContext: AudioContext | null = null;
  let audioSource: MediaElementAudioSourceNode | null = null;
  let observer: ResizeObserver | null = null;
  let canvas: HTMLCanvasElement | null = null;

  const createVisualizer = (config: Readonly<VisualizerPluginConfig>) => {
    visualizerInstance?.destroy();
    visualizerInstance = null;

    if (!audioContext || !audioSource) return;

    const video = document.querySelector<
      HTMLVideoElement & { captureStream(): MediaStream }
    >('video');
    if (!video) {
      return;
    }

    const visualizerContainer = document.querySelector<HTMLElement>('#player');
    if (!visualizerContainer) {
      return;
    }

    if (!canvas?.isConnected) {
      canvas = document.querySelector<HTMLCanvasElement>('#visualizer');
    }
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'visualizer';
      visualizerContainer.prepend(canvas);
    }
    const currentCanvas = canvas;

    const gainNode = audioContext.createGain();
    gainNode.gain.value = 1.25;
    audioSource.connect(gainNode);

    let visualizerType: {
      new (...args: ConstructorParameters<typeof vudio>): Visualizer;
    } = vudio;
    if (config.type === 'wave') {
      visualizerType = wave;
    } else if (config.type === 'butterchurn') {
      visualizerType = butterchurn;
    }
    const instance = new visualizerType(
      audioContext,
      audioSource,
      currentCanvas,
      gainNode,
      video.captureStream(),
      config,
    );
    visualizerInstance = instance;

    const resizeVisualizer = () => {
      const { width, height } = window.getComputedStyle(visualizerContainer);
      currentCanvas.width = Math.ceil(parseFloat(width));
      currentCanvas.height = Math.ceil(parseFloat(height));
      instance.resize(currentCanvas.width, currentCanvas.height);
    };
    resizeVisualizer();

    observer?.disconnect();
    observer = new ResizeObserver(resizeVisualizer);
    observer.observe(visualizerContainer);
  };

  ctx.onCleanup(() => {
    visualizerInstance?.destroy();
    visualizerInstance = null;
    observer?.disconnect();
    observer = null;
    canvas?.remove();
    canvas = null;
  });

  ctx.onConfigChange((config) => createVisualizer(config));

  ctx.onPlayerApiReady(() => {
    ctx.listen(
      document,
      'peard:audio-can-play',
      (e) => {
        audioContext = e.detail.audioContext;
        audioSource = e.detail.audioSource;
        createVisualizer(ctx.config);
      },
      { passive: true },
    );
  });
});
