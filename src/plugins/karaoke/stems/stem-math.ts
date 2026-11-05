export const SOURCE_SAMPLE_RATE = 44100;
export const SEGMENT_SAMPLES = 343980;
/** Segments overlap by a quarter, so a block is the part unique to one segment. */
export const BLOCK_SAMPLES = Math.floor(SEGMENT_SAMPLES * 0.75);

const LOOKAHEAD_SECONDS = 60;

export const getBlockCount = (samples: number) =>
  Math.ceil(samples / BLOCK_SAMPLES);

export const getBlockAt = (timeInSeconds: number) =>
  Math.floor((Math.max(0, timeInSeconds) * SOURCE_SAMPLE_RATE) / BLOCK_SAMPLES);

/**
 * The next block worth separating, or null when far enough ahead. Stopping there
 * spreads the GPU work across the song instead of running flat out at the start.
 */
export const pickNextBlock = (
  done: ReadonlySet<number>,
  playheadInSeconds: number,
  blockCount: number,
  isAvailable: (block: number) => boolean = () => true,
) => {
  const first = getBlockAt(playheadInSeconds);
  const last = Math.min(
    blockCount - 1,
    getBlockAt(playheadInSeconds + LOOKAHEAD_SECONDS),
  );

  for (let block = first; block <= last; block++) {
    if (!done.has(block) && isAvailable(block)) return block;
  }
  return null;
};

/** Where a decoded run goes in the song, given the player's shift of the stream. */
export const placeRun = (startMs: number, offsetSeconds: number) => {
  const seconds = startMs / 1000;
  const start = Math.round((seconds + offsetSeconds) * SOURCE_SAMPLE_RATE);
  return { target: Math.max(0, start), skip: Math.max(0, -start) };
};

/** Fades a segment in and out so that overlapping segments blend. */
export const getOverlapWeight = (index: number, length: number) => {
  const fade = BLOCK_SAMPLES * 0.5;
  return Math.min(index / fade, (length - index) / fade, 1);
};
