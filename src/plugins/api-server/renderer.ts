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
  // Rightmost bars should track presence that exists in typical streaming
  // audio — the final log band is wide in Hz, so keep maxHz modest.
  const maxHz = Math.min(4_200, analyser.context.sampleRate / 2);
  const frequencyRatio = maxHz / minHz;
  // Soften kicks; lift highs — music energy falls with Hz, and wide
  // log HF bands dilute RMS so the right side otherwise stays dark.
  const shelf = Array.from({ length: bandCount }, (_, i) => {
    const t = i / Math.max(1, bandCount - 1);
    const bass = i < 3 ? 0.72 + i * 0.08 : 1;
    const treble = 1 + 1.4 * t * t + (t > 0.6 ? 0.7 * ((t - 0.6) / 0.4) : 0);
    return bass * treble;
  });

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
    let binPeak = 0;
    let topSum = 0;
    let topCount = 0;
    const mix = i / Math.max(1, bandCount - 1);
    // For upper bands, only the louder bins count toward "upper" energy.
    const loudFloor = mix > 0.55 ? 8 : 0;
    for (let bin = start; bin < end; bin++) {
      const v = freqData[bin];
      energy += v * v;
      if (v > binPeak) binPeak = v;
      if (v >= loudFloor) {
        topSum += v;
        topCount += 1;
      }
    }

    const rms = Math.sqrt(energy / (end - start));
    const upper = topCount > 0 ? topSum / topCount : binPeak;
    // Prefer peak-ish measure on the right so sparse HF isn't RMS-diluted.
    const peakW = 0.2 + 0.75 * mix * mix;
    const level =
      (rms * (1 - peakW) + Math.max(binPeak * 0.85, upper) * peakW) * shelf[i];
    bands[i] = level;
    if (level > framePeak) framePeak = level;
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
    // Slightly deeper floor so quiet HF registers in byte data.
    analyser.minDecibels = -90;
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
