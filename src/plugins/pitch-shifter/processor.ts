/* oxlint-disable @stylistic/no-mixed-operators */
// AudioWorklet processor that shifts pitch without changing tempo.
// The worklet runs in its own global scope, so the renderer serialises
// `registerPitchShifterProcessor` with toString() and loads it through a Blob
// URL. Everything it uses must therefore live inside the function body.
//
// It is a phase vocoder: each channel goes through a short-time Fourier
// transform, every bin's true frequency is estimated from its phase advance,
// spectral peaks are moved to their shifted frequency with phase locking, and
// the result is resynthesised with overlap-add. See J. Laroche and M. Dolson,
// "New phase-vocoder techniques for pitch-shifting, harmonizing and other
// exotic effects" (IEEE WASPAA 1999).

export const PROCESSOR_NAME = 'pitch-shifter';

// Globals of AudioWorkletGlobalScope, which the DOM typings do not include.
declare const sampleRate: number;
declare const AudioWorkletProcessor: new () => {
  readonly port: MessagePort;
};
declare function registerProcessor(
  name: string,
  processorCtor: typeof AudioWorkletProcessor,
): void;

export const registerPitchShifterProcessor = (name: string) => {
  const FFT_SIZE = 2048;
  const OVERSAMPLING = 4;
  const HOP = FFT_SIZE / OVERSAMPLING;
  const LATENCY = FFT_SIZE - HOP;
  const HALF = FFT_SIZE / 2;
  const TWO_PI = 2 * Math.PI;
  const EXPECTED_PHASE_ADVANCE = (TWO_PI * HOP) / FFT_SIZE;
  // Hann analysis and synthesis windows overlapped OVERSAMPLING times add up to
  // a constant gain of 3/8 * OVERSAMPLING. Divide it out to keep unity gain.
  const OUTPUT_SCALE = 1 / (FFT_SIZE * 0.375 * OVERSAMPLING);
  // Crossfade between the dry and the shifted signal over ~20 ms when the pitch
  // returns to or leaves 0 semitones, so the switch does not click.
  const FADE_STEP = 1 / 1024;

  const window_ = new Float32Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) {
    window_[i] = 0.5 - 0.5 * Math.cos((TWO_PI * i) / FFT_SIZE);
  }

  const bitReversed = new Uint32Array(FFT_SIZE);
  {
    const bits = Math.log2(FFT_SIZE);
    for (let i = 0; i < FFT_SIZE; i++) {
      let reversed = 0;
      for (let b = 0; b < bits; b++)
        reversed |= ((i >> b) & 1) << (bits - 1 - b);
      bitReversed[i] = reversed;
    }
  }

  const cosTable = new Float64Array(HALF);
  const sinTable = new Float64Array(HALF);
  for (let i = 0; i < HALF; i++) {
    cosTable[i] = Math.cos((TWO_PI * i) / FFT_SIZE);
    sinTable[i] = Math.sin((TWO_PI * i) / FFT_SIZE);
  }

  // In-place iterative radix-2 FFT. sign = -1 forward, +1 inverse (unscaled).
  const fft = (re: Float64Array, im: Float64Array, sign: number) => {
    for (let i = 0; i < FFT_SIZE; i++) {
      const j = bitReversed[i];
      if (j > i) {
        let tmp = re[i];
        re[i] = re[j];
        re[j] = tmp;
        tmp = im[i];
        im[i] = im[j];
        im[j] = tmp;
      }
    }
    for (let size = 2; size <= FFT_SIZE; size <<= 1) {
      const halfSize = size >> 1;
      const tableStep = FFT_SIZE / size;
      for (let start = 0; start < FFT_SIZE; start += size) {
        for (let k = 0; k < halfSize; k++) {
          const wr = cosTable[k * tableStep];
          const wi = sign * sinTable[k * tableStep];
          const a = start + k;
          const b = a + halfSize;
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
  };

  class ChannelShifter {
    binWidth: number;
    inFifo: Float32Array;
    outFifo: Float32Array;
    outputAccum: Float32Array;
    // Spectrum of the current and previous analysis frame.
    re: Float64Array;
    im: Float64Array;
    prevRe: Float64Array;
    prevIm: Float64Array;
    // Spectrum of the current and previous synthesis frame.
    synRe: Float64Array;
    synIm: Float64Array;
    prevSynRe: Float64Array;
    prevSynIm: Float64Array;
    power: Float64Array;
    peaks: Uint32Array;
    rover: number;

    constructor(binWidth: number) {
      this.binWidth = binWidth;
      this.inFifo = new Float32Array(FFT_SIZE);
      this.outFifo = new Float32Array(FFT_SIZE);
      this.outputAccum = new Float32Array(2 * FFT_SIZE);
      this.re = new Float64Array(FFT_SIZE);
      this.im = new Float64Array(FFT_SIZE);
      this.prevRe = new Float64Array(HALF + 1);
      this.prevIm = new Float64Array(HALF + 1);
      this.synRe = new Float64Array(FFT_SIZE);
      this.synIm = new Float64Array(FFT_SIZE);
      this.prevSynRe = new Float64Array(HALF + 1);
      this.prevSynIm = new Float64Array(HALF + 1);
      this.power = new Float64Array(HALF + 1);
      this.peaks = new Uint32Array(HALF);
      this.rover = LATENCY;
    }

    // Pushes one input sample and writes [shifted, dry] output samples into
    // out, both delayed by LATENCY so they line up.
    process(sample: number, ratio: number, out: Float32Array) {
      this.inFifo[this.rover] = sample;
      out[0] = this.outFifo[this.rover - LATENCY];
      out[1] = this.inFifo[this.rover - LATENCY];
      this.rover++;
      if (this.rover >= FFT_SIZE) {
        this.rover = LATENCY;
        this.processFrame(ratio);
      }
    }

    processFrame(ratio: number) {
      const { re, im, prevRe, prevIm, synRe, synIm, power, peaks } = this;
      const { prevSynRe, prevSynIm, binWidth } = this;

      for (let i = 0; i < FFT_SIZE; i++) {
        re[i] = this.inFifo[i] * window_[i];
        im[i] = 0;
      }
      fft(re, im, -1);

      for (let k = 0; k <= HALF; k++) {
        power[k] = re[k] * re[k] + im[k] * im[k];
      }

      // Spectral peaks: local maxima over two neighbours on each side.
      let peakCount = 0;
      for (let k = 2; k <= HALF - 2; k++) {
        const m = power[k];
        if (
          m > power[k - 1] &&
          m >= power[k + 1] &&
          m > power[k - 2] &&
          m >= power[k + 2]
        ) {
          peaks[peakCount++] = k;
        }
      }

      // Synthesis with identity phase locking (Laroche & Dolson): each peak
      // and the bins around it move together by a whole number of bins. The
      // peak phase advances at the shifted frequency, and the bins around it
      // keep their phase offset from the peak, which avoids the "phasey"
      // smearing of shifting every bin on its own. Keeping the offset is a
      // rotation of every bin by the same unit complex number, so the only
      // trigonometry needed is one atan2/cos/sin set per peak.
      synRe.fill(0);
      synIm.fill(0);
      let regionStart = 0;
      for (let p = 0; p < peakCount; p++) {
        const peak = peaks[p];
        let regionEnd = HALF;
        if (p + 1 < peakCount) {
          const next = peaks[p + 1];
          regionEnd = peak + 1;
          for (let k = peak + 2; k < next; k++) {
            if (power[k] < power[regionEnd]) regionEnd = k;
          }
        }
        const start = regionStart;
        regionStart = regionEnd + 1;

        // True frequency of the peak, from how far its phase moved since the
        // previous frame: the angle of X[peak] * conj(prevX[peak]).
        const advanceRe = re[peak] * prevRe[peak] + im[peak] * prevIm[peak];
        const advanceIm = im[peak] * prevRe[peak] - re[peak] * prevIm[peak];
        const expected = peak * EXPECTED_PHASE_ADVANCE;
        let delta = Math.atan2(advanceIm, advanceRe) - expected;
        delta -= TWO_PI * Math.round(delta / TWO_PI);
        const deviation = (OVERSAMPLING * delta) / TWO_PI;
        const shiftedFreq = (peak + deviation) * binWidth * ratio;

        const shift = Math.round(shiftedFreq / binWidth) - peak;
        const target = peak + shift;
        if (target > HALF) break;
        if (target < 0) continue;

        // Continue the phase the previous synthesis frame had at the target.
        const peakAdvance = (TWO_PI * shiftedFreq) / binWidth / OVERSAMPLING;
        const peakPhase =
          Math.atan2(prevSynIm[target], prevSynRe[target]) + peakAdvance;
        // Rotation = e^(i * peakPhase) * conj(X[peak]) / |X[peak]|
        const magnitude = Math.sqrt(power[peak]);
        const unitRe = re[peak] / magnitude;
        const unitIm = -im[peak] / magnitude;
        const cos = Math.cos(peakPhase);
        const sin = Math.sin(peakPhase);
        const rotRe = cos * unitRe - sin * unitIm;
        const rotIm = cos * unitIm + sin * unitRe;

        const first = Math.max(start, -shift);
        const last = Math.min(regionEnd, HALF - shift);
        for (let k = first; k <= last; k++) {
          const bin = k + shift;
          synRe[bin] += re[k] * rotRe - im[k] * rotIm;
          synIm[bin] += re[k] * rotIm + im[k] * rotRe;
        }
      }

      prevRe.set(re.subarray(0, HALF + 1));
      prevIm.set(im.subarray(0, HALF + 1));
      prevSynRe.set(synRe.subarray(0, HALF + 1));
      prevSynIm.set(synIm.subarray(0, HALF + 1));

      // Rebuild the negative frequencies so the inverse transform is real.
      for (let k = HALF + 1; k < FFT_SIZE; k++) {
        synRe[k] = synRe[FFT_SIZE - k];
        synIm[k] = -synIm[FFT_SIZE - k];
      }
      fft(synRe, synIm, 1);

      for (let i = 0; i < FFT_SIZE; i++) {
        this.outputAccum[i] += window_[i] * synRe[i] * OUTPUT_SCALE;
      }
      this.outFifo.set(this.outputAccum.subarray(0, HOP));
      this.outputAccum.copyWithin(0, HOP, HOP + FFT_SIZE);
      this.outputAccum.fill(0, FFT_SIZE);
      this.inFifo.copyWithin(0, HOP, FFT_SIZE);
    }
  }

  class PitchShifterProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      return [
        {
          name: 'semitones',
          defaultValue: 0,
          minValue: -24,
          maxValue: 24,
          automationRate: 'k-rate',
        },
      ];
    }

    channels: ChannelShifter[];
    wet: number;
    frame: Float32Array;
    disposed: boolean;

    constructor() {
      super();
      this.channels = [];
      this.wet = 0;
      this.frame = new Float32Array(2);
      this.disposed = false;
      // The renderer posts 'dispose' when it drops the node. Returning false
      // from process() then lets the browser stop running it.
      this.port.onmessage = ({ data }) => {
        if (data === 'dispose') this.disposed = true;
      };
    }

    process(
      inputs: Float32Array[][],
      outputs: Float32Array[][],
      parameters: Record<string, Float32Array>,
    ) {
      const input = inputs[0];
      const output = outputs[0];
      const semitones = parameters.semitones[0];
      const ratio = Math.pow(2, semitones / 12);
      const targetWet = semitones === 0 ? 0 : 1;

      while (this.channels.length < output.length) {
        this.channels.push(new ChannelShifter(sampleRate / FFT_SIZE));
      }

      const frames = output[0]?.length ?? 0;
      const startWet = this.wet;
      for (let c = 0; c < output.length; c++) {
        const shifter = this.channels[c];
        const source = input[c] ?? input[0];
        const target = output[c];
        let wet = startWet;
        for (let i = 0; i < frames; i++) {
          shifter.process(source ? source[i] : 0, ratio, this.frame);
          if (wet < targetWet) wet = Math.min(targetWet, wet + FADE_STEP);
          else if (wet > targetWet) wet = Math.max(targetWet, wet - FADE_STEP);
          target[i] = this.frame[0] * wet + this.frame[1] * (1 - wet);
        }
        this.wet = wet;
      }

      return !this.disposed;
    }
  }

  registerProcessor(name, PitchShifterProcessor);
};
