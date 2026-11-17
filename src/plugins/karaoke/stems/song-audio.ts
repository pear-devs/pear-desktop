import { PagedAudio } from './paged-audio';
import { BLOCK_SAMPLES, placeRun, SOURCE_SAMPLE_RATE } from './stem-math';
import { type Chunk, groupIntoRuns } from './webm';

import type { AudioStream } from './audio-streams';

type Range = { start: number; end: number };

const clipRanges = (ranges: Range[], start: number, end: number) =>
  ranges
    .map((range) => ({
      start: Math.max(range.start, start),
      end: Math.min(range.end, end),
    }))
    .filter((range) => range.end > range.start);

const decodeRun = async (header: Uint8Array, chunks: Uint8Array[]) => {
  const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const bytes = new Uint8Array(header.length + size);
  bytes.set(header);

  let offset = header.length;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }

  // Decoding through a 44.1 kHz context also resamples to what the model expects.
  const context = new OfflineAudioContext(2, 1, SOURCE_SAMPLE_RATE);
  return await context.decodeAudioData(bytes.buffer);
};

const LEFT = 0;
const RIGHT = 1;

// Decoding starts one chunk early, so the codec has settled by the window.
const LEAD_CHUNKS = 1;

/**
 * The decoded song, filled in as the player receives it. Only a window of it is
 * held (pages are blocks), and only the audio that window needs is decoded.
 */
export class SongAudio {
  private readonly audio: PagedAudio;
  private ranges: Range[] = [];
  private decoded = new Map<string, Range>();
  private decodedState = '';
  private first = 0;
  private last = Number.POSITIVE_INFINITY;

  private earlierRanges: Range[] = [];
  private lastStream: AudioStream | null = null;
  private lastRevision = 0;
  /**
   * Goes up when the current stream's timeline changes, so anything separated
   * from audio placed with the old timeline must be computed again.
   */
  timeline = 0;

  constructor(
    private stream: AudioStream,
    duration: number,
  ) {
    const samples = Math.ceil(duration * SOURCE_SAMPLE_RATE);
    this.audio = new PagedAudio(2, BLOCK_SAMPLES, samples);
  }

  get length() {
    return this.audio.length;
  }

  /** Keeps blocks first..last. */
  setWindow(first: number, last: number) {
    this.audio.setWindow(first, last);
    this.first = first;
    this.last = last;

    // Dropped pages are no longer audio that has arrived.
    const start = first * BLOCK_SAMPLES;
    const end = (last + 1) * BLOCK_SAMPLES;
    this.ranges = clipRanges(this.ranges, start, end);
    this.earlierRanges = clipRanges(this.earlierRanges, start, end);
  }

  read(channel: 'left' | 'right', start: number, length: number) {
    return this.audio.read(channel === 'left' ? LEFT : RIGHT, start, length);
  }

  /** Follows the player when it moves this song to a new stream. */
  useStream(stream: AudioStream) {
    if (stream === this.stream) return;

    this.stream = stream;
    this.earlierRanges = this.ranges;
    this.decoded = new Map();
    this.decodedState = '';
  }

  /** The chunks of a run that the window needs, with a little lead-in. */
  private chunksInWindow(run: Chunk[]) {
    const offsetMs = this.stream.timeOffset * 1000;
    const toMs = (samples: number) => (samples / SOURCE_SAMPLE_RATE) * 1000;
    const startMs = toMs(this.first * BLOCK_SAMPLES) - offsetMs;
    const endMs = toMs((this.last + 1) * BLOCK_SAMPLES) - offsetMs;

    const firstIndex = run.findIndex((chunk) => chunk.endMs >= startMs);
    if (firstIndex === -1) return [];
    let lastIndex = run.length - 1;
    while (lastIndex > firstIndex && run[lastIndex].startMs > endMs)
      lastIndex--;
    if (run[firstIndex].startMs > endMs) return [];

    return run.slice(Math.max(0, firstIndex - LEAD_CHUNKS), lastIndex + 1);
  }

  /**
   * Decodes what the window needs and has not been decoded yet. A decode that
   * the stream invalidates while it runs is thrown away, and tried again later.
   */
  async update() {
    const stream = this.stream;
    const { revision, version } = stream;
    if (stream === this.lastStream && revision !== this.lastRevision) {
      this.timeline++;
    }
    this.lastStream = stream;
    this.lastRevision = revision;
    const state = `${revision}:${version}:${this.first}-${this.last}`;
    if (state === this.decodedState) return;

    const isStale = () =>
      stream !== this.stream || stream.revision !== revision;

    const decoded = new Map<string, Range>();
    for (const run of groupIntoRuns(stream.getChunks())) {
      const chunks = this.chunksInWindow(run);
      if (!chunks.length) continue;

      const key = `${revision}:${chunks[0].startMs}:${chunks.at(-1)?.startMs}:${chunks.length}`;
      const known = this.decoded.get(key);
      // Only the part inside the window is ever held.
      const windowStart = this.first * BLOCK_SAMPLES;
      const windowEnd = (this.last + 1) * BLOCK_SAMPLES;
      if (
        known &&
        this.audio.holds(
          Math.max(known.start, windowStart),
          Math.min(known.end, windowEnd),
        )
      ) {
        decoded.set(key, known);
        continue;
      }

      const song = await decodeRun(
        stream.header,
        chunks.map((chunk) => chunk.bytes),
      );
      if (isStale()) {
        // What is held was placed with the old timeline, so none of it counts
        // as arrived until a fresh pass places it again.
        this.ranges = [...this.earlierRanges];
        this.decoded = new Map();
        return;
      }

      const { target, skip } = placeRun(chunks[0].startMs, stream.timeOffset);
      const length = Math.min(song.length - skip, this.length - target);
      if (length <= 0) continue;

      const left = song.getChannelData(0);
      const right = song.numberOfChannels > 1 ? song.getChannelData(1) : left;
      this.audio.write(LEFT, target, left.subarray(skip, skip + length));
      this.audio.write(RIGHT, target, right.subarray(skip, skip + length));
      decoded.set(key, { start: target, end: target + length });
    }

    this.decoded = decoded;
    this.ranges = [...this.earlierRanges, ...decoded.values()];
    // Only once decoding succeeded, so a failed or stale pass is tried again.
    this.decodedState = state;
  }

  describe() {
    const seconds = (samples: number) =>
      (samples / SOURCE_SAMPLE_RATE).toFixed(1);
    const ranges = this.ranges
      .map((range) => `${seconds(range.start)}-${seconds(range.end)}`)
      .join(',');
    return `length=${seconds(this.length)} ranges=${ranges} pages=${this.audio.pageCount}`;
  }

  /**
   * Whether a stretch of the song has arrived. The song's last second may be
   * missing, but audio must have arrived at the start of the stretch.
   */
  has(start: number, end: number) {
    const target = Math.max(
      start + 1,
      Math.min(end, this.length - SOURCE_SAMPLE_RATE),
    );
    return (
      this.ranges.some(
        (range) => range.start <= start && range.end >= target,
      ) && this.audio.holds(start, target)
    );
  }
}
