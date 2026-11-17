/* oxlint-disable no-undef, typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-call, typescript/no-unsafe-argument, typescript/no-unsafe-return, @stylistic/no-mixed-operators */
// Runs on the audio thread and is loaded from a Blob, so it cannot import.
//
// Splits the signal into short overlapping frames and looks at each frequency
// on its own. Where left and right match in level and phase the sound is mixed
// to the center, so that shared part is subtracted from both channels. Anything
// else keeps its original level and stereo position.

const FFT_SIZE = 2048;
const HOP_SIZE = FFT_SIZE / 4;
const BINS = FFT_SIZE / 2 + 1;
const MASK = FFT_SIZE - 1;

// sqrt(Hann) on both analysis and synthesis sums to 2 at a quarter-frame hop.
const OVERLAP_GAIN = 0.5;

// Left/right similarity runs from 1 (identical) down to -1 (opposite). In a real
// mix a vocal shares each bin with other instruments, so it scores far below 1.
// These values were chosen by measuring real songs, not test tones.
const SIMILARITY_START = 0;
const SIMILARITY_FULL = 0.5;

// Keeps kick and bass below, and presence, cymbals and air above.
const LOW_FADE_HZ = [120, 200];
const HIGH_FADE_HZ = [5500, 9000];

// In a narrow mix nearly all the music is in the center with the vocal, so full
// removal would flatten the song. This is the lowest the band may be pushed.
const MIN_BAND_LEVEL_DB = -15;
const MIN_BAND_POWER = 10 ** (MIN_BAND_LEVEL_DB / 10);
const WIDTH_SMOOTHING = 0.99;

// A drum hit rises across most of the spectrum at once, while a vocal only rises
// at its harmonics. Such moments are mostly let through to keep the mix punchy.
const TRANSIENT_RISE = 3;
const TRANSIENT_START_SHARE = 0.2;
const TRANSIENT_FULL_SHARE = 0.5;
const TRANSIENT_KEEP = 0.7;
const TRANSIENT_RELEASE = 0.7;

const SIMILARITY_SMOOTHING = 0.6;

// How much the subtraction is limited to what both channels really share. At 0
// it removes the whole mid signal, which leaves the two sides in anti-phase.
const COMMON_BLEND = 0.25;

// With the center gone, what remains is L - R, which is in anti-phase by nature
// and sounds phasey. This turns that leftover back in phase, but only as far as
// a bin was treated as center, so panned instruments keep their position.
const RESIDUAL_FOLD = 0.75;

const MONO_ENTER_SIMILARITY = 0.998;
const MONO_LEAVE_SIMILARITY = 0.99;
const MONO_SMOOTHING = 0.97;
const SILENCE = 1e-9;

const smoothstep = (value) => {
  const clamped = Math.min(1, Math.max(0, value));
  return clamped * clamped * (3 - 2 * clamped);
};

class CenterRemover extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'amount',
        defaultValue: 1,
        minValue: 0,
        maxValue: 1,
        automationRate: 'k-rate',
      },
    ];
  }

  constructor() {
    super();

    this.inputLeft = new Float32Array(FFT_SIZE);
    this.inputRight = new Float32Array(FFT_SIZE);
    this.outputLeft = new Float32Array(FFT_SIZE);
    this.outputRight = new Float32Array(FFT_SIZE);
    this.position = 0;
    this.samplesUntilFrame = HOP_SIZE;

    this.real = new Float64Array(FFT_SIZE);
    this.imaginary = new Float64Array(FFT_SIZE);
    this.outReal = new Float64Array(FFT_SIZE);
    this.outImaginary = new Float64Array(FFT_SIZE);
    this.shared = new Float64Array(BINS);
    this.power = new Float64Array(BINS);

    this.window = new Float64Array(FFT_SIZE);
    for (let i = 0; i < FFT_SIZE; i++) {
      this.window[i] = Math.sin((Math.PI * i) / FFT_SIZE);
    }

    this.bandWeight = new Float64Array(BINS);
    for (let bin = 0; bin < BINS; bin++) {
      const hz = (bin * sampleRate) / FFT_SIZE;
      const low = (hz - LOW_FADE_HZ[0]) / (LOW_FADE_HZ[1] - LOW_FADE_HZ[0]);
      const high = (HIGH_FADE_HZ[1] - hz) / (HIGH_FADE_HZ[1] - HIGH_FADE_HZ[0]);
      this.bandWeight[bin] = smoothstep(low) * smoothstep(high);
    }

    this.bitReversed = new Uint32Array(FFT_SIZE);
    const bits = Math.log2(FFT_SIZE);
    for (let i = 0; i < FFT_SIZE; i++) {
      let reversed = 0;
      for (let bit = 0; bit < bits; bit++) {
        reversed = (reversed << 1) | ((i >> bit) & 1);
      }
      this.bitReversed[i] = reversed;
    }

    this.twiddleReal = new Float64Array(FFT_SIZE / 2);
    this.twiddleImaginary = new Float64Array(FFT_SIZE / 2);
    for (let i = 0; i < FFT_SIZE / 2; i++) {
      this.twiddleReal[i] = Math.cos((2 * Math.PI * i) / FFT_SIZE);
      this.twiddleImaginary[i] = -Math.sin((2 * Math.PI * i) / FFT_SIZE);
    }

    this.trackSimilarity = 0;
    this.trackShared = 0;
    this.trackPower = 0;
    this.transient = 0;
    this.isMono = false;
  }

  // In-place radix-2 FFT. `direction` is 1 for forward and -1 for inverse.
  transform(real, imaginary, direction) {
    for (let i = 0; i < FFT_SIZE; i++) {
      const j = this.bitReversed[i];
      if (j > i) {
        const tempReal = real[i];
        const tempImaginary = imaginary[i];
        real[i] = real[j];
        imaginary[i] = imaginary[j];
        real[j] = tempReal;
        imaginary[j] = tempImaginary;
      }
    }

    for (let size = 2; size <= FFT_SIZE; size *= 2) {
      const half = size / 2;
      const step = FFT_SIZE / size;
      for (let start = 0; start < FFT_SIZE; start += size) {
        for (let k = 0; k < half; k++) {
          const wr = this.twiddleReal[k * step];
          const wi = this.twiddleImaginary[k * step] * direction;
          const even = start + k;
          const odd = even + half;
          const tr = real[odd] * wr - imaginary[odd] * wi;
          const ti = real[odd] * wi + imaginary[odd] * wr;
          real[odd] = real[even] - tr;
          imaginary[odd] = imaginary[even] - ti;
          real[even] += tr;
          imaginary[even] += ti;
        }
      }
    }
  }

  updateMonoState(sharedTotal, powerTotal) {
    if (powerTotal < SILENCE) return;

    const similarity = (2 * sharedTotal) / powerTotal;
    this.trackSimilarity =
      MONO_SMOOTHING * this.trackSimilarity + (1 - MONO_SMOOTHING) * similarity;

    const threshold = this.isMono
      ? MONO_LEAVE_SIMILARITY
      : MONO_ENTER_SIMILARITY;
    const isMono = this.trackSimilarity > threshold;
    if (isMono !== this.isMono) {
      this.isMono = isMono;
      this.port.postMessage({ isMono });
    }
  }

  // Highest amount that keeps the band above MIN_BAND_POWER for this song.
  getAmountLimit(sharedTotal, powerTotal) {
    if (powerTotal < SILENCE) return 1;

    this.trackShared =
      WIDTH_SMOOTHING * this.trackShared + (1 - WIDTH_SMOOTHING) * sharedTotal;
    this.trackPower =
      WIDTH_SMOOTHING * this.trackPower + (1 - WIDTH_SMOOTHING) * powerTotal;

    // |L|^2 + |R|^2 = 2 (mid^2 + side^2), and Re(L R*) = mid^2 - side^2.
    const mid = (this.trackPower / 2 + this.trackShared) / 2;
    const side = (this.trackPower / 2 - this.trackShared) / 2;
    const missing = MIN_BAND_POWER * (mid + side) - side;

    if (missing <= 0 || mid <= SILENCE) return 1;
    return Math.max(0, 1 - Math.sqrt(missing / mid));
  }

  updateTransient(risingBins, bandBins) {
    const share = risingBins / Math.max(1, bandBins);
    const instant = smoothstep(
      (share - TRANSIENT_START_SHARE) /
        (TRANSIENT_FULL_SHARE - TRANSIENT_START_SHARE),
    );
    this.transient = Math.max(instant, this.transient * TRANSIENT_RELEASE);
  }

  processFrame(amount) {
    const { real, imaginary, outReal, outImaginary, shared, power } = this;

    // Two real signals share one complex transform: left + i * right.
    for (let i = 0; i < FFT_SIZE; i++) {
      const index = (this.position + i) & MASK;
      real[i] = this.inputLeft[index] * this.window[i];
      imaginary[i] = this.inputRight[index] * this.window[i];
    }
    this.transform(real, imaginary, 1);

    let sharedTotal = 0;
    let powerTotal = 0;
    let risingBins = 0;
    let bandBins = 0;

    for (let bin = 0; bin < BINS; bin++) {
      const mirror = (FFT_SIZE - bin) & MASK;
      const leftReal = (real[bin] + real[mirror]) / 2;
      const leftImaginary = (imaginary[bin] - imaginary[mirror]) / 2;
      const rightReal = (imaginary[bin] + imaginary[mirror]) / 2;
      const rightImaginary = (real[mirror] - real[bin]) / 2;

      const binShared = leftReal * rightReal + leftImaginary * rightImaginary;
      const binPower =
        leftReal * leftReal +
        leftImaginary * leftImaginary +
        rightReal * rightReal +
        rightImaginary * rightImaginary;

      if (this.bandWeight[bin] > 0) {
        bandBins++;
        if (binPower > TRANSIENT_RISE * power[bin] + SILENCE) risingBins++;
      }

      shared[bin] =
        SIMILARITY_SMOOTHING * shared[bin] +
        (1 - SIMILARITY_SMOOTHING) * binShared;
      power[bin] =
        SIMILARITY_SMOOTHING * power[bin] +
        (1 - SIMILARITY_SMOOTHING) * binPower;

      if (this.bandWeight[bin] > 0) {
        sharedTotal += binShared;
        powerTotal += binPower;
      }
    }

    this.updateMonoState(sharedTotal, powerTotal);

    // A mono track is all center, so removing it would remove the whole song.
    const limit = this.getAmountLimit(sharedTotal, powerTotal);
    this.updateTransient(risingBins, bandBins);
    const effectiveAmount = this.isMono
      ? 0
      : Math.min(amount, limit) * (1 - TRANSIENT_KEEP * this.transient);

    for (let bin = 0; bin < BINS; bin++) {
      const mirror = (FFT_SIZE - bin) & MASK;
      const leftReal = (real[bin] + real[mirror]) / 2;
      const leftImaginary = (imaginary[bin] - imaginary[mirror]) / 2;
      const rightReal = (imaginary[bin] + imaginary[mirror]) / 2;
      const rightImaginary = (real[mirror] - real[bin]) / 2;

      // Neighbouring bins vote too, which keeps the mask from flickering.
      const before = Math.max(bin - 1, 0);
      const after = Math.min(bin + 1, BINS - 1);
      const sharedNearby = shared[before] + shared[bin] + shared[after];
      const powerNearby = power[before] + power[bin] + power[after];
      const similarity = (2 * sharedNearby) / (powerNearby + SILENCE);

      const removal =
        effectiveAmount *
        this.bandWeight[bin] *
        smoothstep(
          (similarity - SIMILARITY_START) /
            (SIMILARITY_FULL - SIMILARITY_START),
        );

      const midReal = (leftReal + rightReal) / 2;
      const midImaginary = (leftImaginary + rightImaginary) / 2;
      const common = Math.min(
        Math.hypot(leftReal, leftImaginary),
        Math.hypot(rightReal, rightImaginary),
      );
      const commonShare =
        common / (Math.hypot(midReal, midImaginary) + SILENCE);
      const share = COMMON_BLEND * commonShare + (1 - COMMON_BLEND);
      const scale = removal * Math.min(1, share);

      const centerReal = midReal * scale;
      const centerImaginary = midImaginary * scale;

      const newLeftReal = leftReal - centerReal;
      const newLeftImaginary = leftImaginary - centerImaginary;
      const fold = RESIDUAL_FOLD * removal;
      const newRightReal =
        rightReal - centerReal + fold * (leftReal - rightReal);
      const newRightImaginary =
        rightImaginary -
        centerImaginary +
        fold * (leftImaginary - rightImaginary);

      // Packs both channels back into left + i * right.
      outReal[bin] = newLeftReal - newRightImaginary;
      outImaginary[bin] = newLeftImaginary + newRightReal;
      if (bin > 0 && bin < FFT_SIZE / 2) {
        outReal[mirror] = newLeftReal + newRightImaginary;
        outImaginary[mirror] = newRightReal - newLeftImaginary;
      }
    }

    this.transform(outReal, outImaginary, -1);

    const scale = OVERLAP_GAIN / FFT_SIZE;
    for (let i = 0; i < FFT_SIZE; i++) {
      const index = (this.position + i) & MASK;
      this.outputLeft[index] += outReal[i] * this.window[i] * scale;
      this.outputRight[index] += outImaginary[i] * this.window[i] * scale;
    }
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (input.length === 0) return true;

    const left = input[0];
    const right = input[1] ?? input[0];
    const amount = parameters.amount[0];

    for (let i = 0; i < left.length; i++) {
      const index = this.position;
      this.inputLeft[index] = left[i];
      this.inputRight[index] = right[i];
      output[0][i] = this.outputLeft[index];
      output[1][i] = this.outputRight[index];
      this.outputLeft[index] = 0;
      this.outputRight[index] = 0;
      this.position = (index + 1) & MASK;

      if (--this.samplesUntilFrame === 0) {
        this.samplesUntilFrame = HOP_SIZE;
        this.processFrame(amount);
      }
    }

    return true;
  }
}

registerProcessor('karaoke-center-remover', CenterRemover);
