/**
 * Musical key detection (chroma + Krumhansl-Kessler key profiles) and
 * Camelot wheel compatibility, used to avoid overlapping clashing keys.
 */

export interface MusicalKey {
  /** 0 = C … 11 = B */
  pitchClass: number;
  mode: 'major' | 'minor';
  /** Camelot wheel code, e.g. "8A" (A minor) or "8B" (C major) */
  camelot: string;
  /** Correlation of the best key profile (0..1) */
  confidence: number;
}

const NOTE_NAMES = [
  'C',
  'D♭',
  'D',
  'E♭',
  'E',
  'F',
  'F♯',
  'G',
  'A♭',
  'A',
  'B♭',
  'B',
];

const MAJOR_PROFILE = [
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];
const MINOR_PROFILE = [
  6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];

const FRAME = 4096;
const HOP = 2048;
const MIN_HZ = 55;
const MAX_HZ = 2000;
/** Below this the key is too unclear to act on */
export const MIN_KEY_CONFIDENCE = 0.55;

export const keyName = (key: MusicalKey) =>
  `${NOTE_NAMES[key.pitchClass]} ${key.mode}`;

/** In-place iterative radix-2 FFT */
const fft = (re: Float64Array, im: Float64Array) => {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = (-2 * Math.PI) / size;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);
    for (let start = 0; start < n; start += size) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < size / 2; k++) {
        const a = start + k;
        const b = a + (size / 2);
        const tRe = (re[b] * curRe) - (im[b] * curIm);
        const tIm = (re[b] * curIm) + (im[b] * curRe);
        re[b] = re[a] - tRe;
        im[b] = im[a] - tIm;
        re[a] += tRe;
        im[a] += tIm;
        const nextRe = (curRe * wRe) - (curIm * wIm);
        curIm = (curRe * wIm) + (curIm * wRe);
        curRe = nextRe;
      }
    }
  }
};

const correlation = (a: number[], b: number[]) => {
  const meanA = a.reduce((sum, v) => sum + v, 0) / a.length;
  const meanB = b.reduce((sum, v) => sum + v, 0) / b.length;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - meanA) * (b[i] - meanB);
    denA += (a[i] - meanA) ** 2;
    denB += (b[i] - meanB) ** 2;
  }
  return denA > 0 && denB > 0 ? num / Math.sqrt(denA * denB) : 0;
};

const camelotFor = (pitchClass: number, mode: 'major' | 'minor') => {
  // Camelot numbers follow the circle of fifths; a minor key shares its
  // number with its relative major (three semitones up)
  const major = mode === 'major' ? pitchClass : (pitchClass + 3) % 12;
  const number = ((((major * 7) % 12) + 7) % 12) + 1;
  return `${number}${mode === 'major' ? 'B' : 'A'}`;
};

/** Detects the key of `signal` (mono) between two times, in seconds */
export const detectKey = (
  signal: Float32Array,
  sampleRate: number,
  fromSeconds: number,
  toSeconds: number,
): MusicalKey | null => {
  const first = Math.max(0, Math.floor(fromSeconds * sampleRate));
  const last = Math.min(signal.length, Math.floor(toSeconds * sampleRate));
  if (last - first < FRAME * 4) return null;

  const window = new Float64Array(FRAME);
  for (let i = 0; i < FRAME; i++) {
    window[i] = 0.5 - (0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1)));
  }

  // Pitch class of every FFT bin in range
  const binClass = new Int8Array(FRAME / 2).fill(-1);
  for (let bin = 1; bin < FRAME / 2; bin++) {
    const hz = (bin * sampleRate) / FRAME;
    if (hz < MIN_HZ || hz > MAX_HZ) continue;
    const midi = Math.round((12 * Math.log2(hz / 440)) + 69);
    binClass[bin] = ((midi % 12) + 12) % 12;
  }

  const chroma = new Array<number>(12).fill(0);
  const re = new Float64Array(FRAME);
  const im = new Float64Array(FRAME);
  for (let start = first; start + FRAME <= last; start += HOP) {
    for (let i = 0; i < FRAME; i++) {
      re[i] = signal[start + i] * window[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let bin = 1; bin < FRAME / 2; bin++) {
      const pitchClass = binClass[bin];
      if (pitchClass < 0) continue;
      chroma[pitchClass] += Math.sqrt(Math.hypot(re[bin], im[bin]));
    }
  }
  if (chroma.every((v) => v === 0)) return null;

  let best: MusicalKey | null = null;
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const mode of ['major', 'minor'] as const) {
      const profile = mode === 'major' ? MAJOR_PROFILE : MINOR_PROFILE;
      const rotated = profile.map((_, i) => profile[(i - tonic + 12) % 12]);
      const score = correlation(chroma, rotated);
      if (!best || score > best.confidence) {
        best = {
          pitchClass: tonic,
          mode,
          camelot: camelotFor(tonic, mode),
          confidence: score,
        };
      }
    }
  }
  return best;
};

/**
 * Harmonic mixing on the Camelot wheel: the same key, its relative
 * major / minor, or one step round the wheel all blend well.
 */
export const keysCompatible = (a: MusicalKey, b: MusicalKey) => {
  const numberA = Number.parseInt(a.camelot, 10);
  const numberB = Number.parseInt(b.camelot, 10);
  const letterA = a.camelot.at(-1);
  const letterB = b.camelot.at(-1);
  const steps = Math.min(
    Math.abs(numberA - numberB),
    12 - Math.abs(numberA - numberB),
  );
  return steps === 0 || (steps === 1 && letterA === letterB);
};

/** True only when both keys are clear enough and they don't fit together */
export const keysClash = (a?: MusicalKey | null, b?: MusicalKey | null) =>
  Boolean(
    a &&
    b &&
    a.confidence >= MIN_KEY_CONFIDENCE &&
    b.confidence >= MIN_KEY_CONFIDENCE &&
    !keysCompatible(a, b),
  );
