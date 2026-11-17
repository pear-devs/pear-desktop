import { PagedAudio } from './paged-audio';
import { BLOCK_SAMPLES, placeRun, SOURCE_SAMPLE_RATE } from './stem-math';
import { groupIntoRuns } from './webm';

import type { AudioStream } from './audio-streams';

type Range = { start: number; end: number };

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

/**
 * The decoded song, filled in as the player receives it. Only a window of it is
 * held (pages are blocks); moving the window decodes again what it now needs.
 */
export class SongAudio {
  private readonly audio: PagedAudio;
  private ranges: Range[] = [];
  private decodedVersion = -1;
  private decodedWindow = '';
  private window = '';

  private earlierRanges: Range[] = [];

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
    this.window = `${first}-${last}`;
  }

  read(channel: 'left' | 'right', start: number, length: number) {
    return this.audio.read(channel === 'left' ? LEFT : RIGHT, start, length);
  }

  /** Follows the player when it moves this song to a new stream. */
  useStream(stream: AudioStream) {
    if (stream === this.stream) return;

    this.stream = stream;
    this.earlierRanges = this.ranges;
    this.decodedVersion = -1;
  }

  /** Decodes whatever has arrived since the last call. */
  async update() {
    const version = this.stream.version;
    const window = this.window;
    if (version === this.decodedVersion && window === this.decodedWindow)
      return;

    const ranges: Range[] = [];
    for (const run of groupIntoRuns(this.stream.getChunks())) {
      const song = await decodeRun(
        this.stream.header,
        run.map((chunk) => chunk.bytes),
      );

      const { target, skip } = placeRun(run[0].startMs, this.stream.timeOffset);
      const length = Math.min(song.length - skip, this.length - target);
      if (length <= 0) continue;

      const left = song.getChannelData(0);
      const right = song.numberOfChannels > 1 ? song.getChannelData(1) : left;
      this.audio.write(LEFT, target, left.subarray(skip, skip + length));
      this.audio.write(RIGHT, target, right.subarray(skip, skip + length));
      ranges.push({ start: target, end: target + length });
    }
    this.ranges = [...this.earlierRanges, ...ranges];
    // Only once decoding succeeded, so a failed version is tried again.
    this.decodedVersion = version;
    this.decodedWindow = window;
  }

  describe() {
    const seconds = (samples: number) =>
      (samples / SOURCE_SAMPLE_RATE).toFixed(1);
    const ranges = this.ranges
      .map((range) => `${seconds(range.start)}-${seconds(range.end)}`)
      .join(',');
    return `length=${seconds(this.length)} ranges=${ranges} pages=${this.audio.pageCount}`;
  }

  /** Whether a stretch of the song has arrived, allowing for its last moments. */
  has(start: number, end: number) {
    const target = Math.min(end, this.length - SOURCE_SAMPLE_RATE);
    return (
      this.ranges.some(
        (range) => range.start <= start && range.end >= target,
      ) && this.audio.holds(start, target)
    );
  }
}
