/**
 * Finds where a short capture of what the player actually played sits in
 * AutoMix's copy of the song, to the sample. The player's reported
 * currentTime is tens of milliseconds off from what comes out of the
 * audio graph, and that is enough to make the beat stumble at a hand-off.
 */

const DECIMATE = 8;

const mono = (buffer: AudioBuffer, first: number, length: number) => {
  const out = new Float32Array(length);
  const channels = buffer.numberOfChannels;
  for (let channel = 0; channel < channels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) out[i] += data[first + i] / channels;
  }
  return out;
};

const decimate = (signal: Float32Array, factor: number) => {
  const out = new Float32Array(Math.floor(signal.length / factor));
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    for (let k = 0; k < factor; k++) sum += signal[(i * factor) + k];
    out[i] = sum / factor;
  }
  return out;
};

/** Normalised cross-correlation of `needle` against `hay` at each lag */
const bestLag = (
  needle: Float32Array,
  hay: Float32Array,
  fromLag: number,
  toLag: number,
) => {
  let needleEnergy = 0;
  for (const v of needle) needleEnergy += v * v;
  if (needleEnergy === 0) return null;

  let best = -1;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let lag = Math.max(0, fromLag); lag <= toLag; lag++) {
    if (lag + needle.length > hay.length) break;
    let dot = 0;
    let energy = 0;
    for (let i = 0; i < needle.length; i++) {
      const h = hay[lag + i];
      dot += needle[i] * h;
      energy += h * h;
    }
    if (energy === 0) continue;
    const score = dot / Math.sqrt(needleEnergy * energy);
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  return best < 0 ? null : { lag: best, score: bestScore };
};

/**
 * Locates `capture` (mono, at the buffer's sample rate) in `buffer`,
 * searching start positions between `fromSeconds` and `toSeconds`.
 * Returns the matching start time (buffer seconds) and how well it matched.
 */
export const locateCapture = (
  capture: Float32Array,
  buffer: AudioBuffer,
  fromSeconds: number,
  toSeconds: number,
): { time: number; score: number } | null => {
  const rate = buffer.sampleRate;
  const first = Math.max(0, Math.floor(fromSeconds * rate));
  const last = Math.min(
    buffer.length - capture.length,
    Math.ceil(toSeconds * rate),
  );
  if (last <= first) return null;
  const region = mono(buffer, first, last - first + capture.length);

  // Coarse search on a decimated signal, then refine at full rate
  const coarse = bestLag(
    decimate(capture, DECIMATE),
    decimate(region, DECIMATE),
    0,
    Math.floor((last - first) / DECIMATE),
  );
  if (!coarse) return null;
  const fine = bestLag(
    capture,
    region,
    (coarse.lag - 2) * DECIMATE,
    (coarse.lag + 2) * DECIMATE,
  );
  if (!fine) return null;
  return { time: (first + fine.lag) / rate, score: fine.score };
};
