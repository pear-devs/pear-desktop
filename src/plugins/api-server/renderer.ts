import type { APIServerConfig } from './config';
import type { RendererContext } from '@/types/contexts';

/**
 * Exposes real-time audio spectrum samples to the backend.
 * Sampling is driven by the main process (not a renderer timer) so it
 * stays responsive when the Pear window is unfocused / backgrounded.
 */

let config: APIServerConfig | undefined;
let rendererIpc: RendererContext<APIServerConfig>['ipc'] | undefined;

let analyser: AnalyserNode | null = null;
let audioContext: AudioContext | null = null;
let freqData: Uint8Array<ArrayBuffer> | null = null;
let connectedSource: MediaElementAudioSourceNode | null = null;

/** Rolling peak used to leave headroom so bars don't sit pegged. */
let rollingPeak = 48;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/**
 * Collapse FFT bins into log-spaced bands (0-255).
 */
const computeBands = (bandCount: number): number[] => {
  if (!analyser || !freqData) return [];

  analyser.getByteFrequencyData(freqData);

  const binCount = freqData.length;
  const hzPerBin = analyser.context.sampleRate / analyser.fftSize;
  const minHz = 40;
  const maxHz = Math.min(14_000, analyser.context.sampleRate / 2);
  const frequencyRatio = maxHz / minHz;
  // Soften the extreme low end a bit so kicks don't dominate every bar.
  const shelf = Array.from({ length: bandCount }, (_, i) =>
    i < 3 ? 0.72 + i * 0.08 : 1,
  );

  const bands = Array.from({ length: bandCount }, () => 0);
  let framePeak = 1;

  for (let i = 0; i < bandCount; i++) {
    const lowHz = minHz * Math.pow(frequencyRatio, i / bandCount);
    const highHz = minHz * Math.pow(frequencyRatio, (i + 1) / bandCount);
    const start = clamp(Math.floor(lowHz / hzPerBin), 1, binCount - 1);
    const end = clamp(
      Math.max(Math.ceil(highHz / hzPerBin), start + 1),
      2,
      binCount,
    );

    let energy = 0;
    for (let bin = start; bin < end; bin++) {
      const v = freqData[bin];
      energy += v * v;
    }

    const rms = Math.sqrt(energy / (end - start)) * shelf[i];
    bands[i] = rms;
    if (rms > framePeak) framePeak = rms;
  }

  // Slow AGC — track loudness, keep clear headroom above recent peaks.
  rollingPeak = Math.max(28, rollingPeak * 0.9 + framePeak * 0.1);
  const scale = 145 / rollingPeak;

  for (let i = 0; i < bandCount; i++) {
    // Mild compression keeps dynamics without slamming the ceiling.
    const shaped = Math.pow(Math.max(0, bands[i] * scale) / 255, 1.05) * 255;
    bands[i] = Math.round(clamp(shaped, 0, 185));
  }

  return bands;
};

const sampleAndSend = () => {
  if (!config?.spectrumEnabled || !analyser || !rendererIpc) return;

  // Chromium can suspend AudioContext when unfocused — keep it alive.
  if (audioContext?.state == 'suspended') {
    void audioContext.resume();
  }

  const bandCount = clamp(Math.round(config.spectrumBands ?? 16), 4, 64);
  const bands = computeBands(bandCount);
  if (!bands.length) return;

  let peak = 0;
  for (const value of bands) {
    if (value > peak) peak = value;
  }

  rendererIpc.send('peard:audio-spectrum', {
    bands,
    peak,
    timestamp: Date.now(),
  });
};

const audioCanPlayListener = (e: CustomEvent<Compressor>) => {
  const { audioContext: ctx, audioSource } = e.detail;
  if (!ctx || !audioSource) return;

  audioContext = ctx;

  if (!analyser || analyser.context != ctx) {
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.55;
    analyser.minDecibels = -80;
    analyser.maxDecibels = -25;
    freqData = new Uint8Array(analyser.frequencyBinCount);
    connectedSource = null;
    rollingPeak = 48;
  }

  if (connectedSource != audioSource) {
    audioSource.connect(analyser);
    connectedSource = audioSource;
  }

  if (ctx.state == 'suspended') {
    void ctx.resume();
  }
};

const onRequestSpectrum = () => {
  sampleAndSend();
};

export const onRendererLoad = async ({
  getConfig,
  ipc,
}: RendererContext<APIServerConfig>) => {
  config = await getConfig();
  rendererIpc = ipc;

  // Main process drives the sample rate so background throttling doesn't apply.
  ipc.on('peard:request-spectrum', onRequestSpectrum);

  document.addEventListener('peard:audio-can-play', audioCanPlayListener, {
    passive: true,
  });
};

export const onRendererConfigChange = (newConfig: APIServerConfig) => {
  config = newConfig;
};

export const onRendererUnload = () => {
  document.removeEventListener('peard:audio-can-play', audioCanPlayListener);
  rendererIpc?.removeAllListeners('peard:request-spectrum');

  if (connectedSource && analyser) {
    try {
      connectedSource.disconnect(analyser);
    } catch {
      // already disconnected
    }
  }

  analyser = null;
  audioContext = null;
  freqData = null;
  connectedSource = null;
  rendererIpc = undefined;
};
