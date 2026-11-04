import { SOURCE_SAMPLE_RATE } from './stem-math';
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

/** The decoded song, filled in as the player receives it. */
export class SongAudio {
  readonly left: Float32Array;
  readonly right: Float32Array;
  private ranges: Range[] = [];
  private decodedVersion = -1;

  private earlierRanges: Range[] = [];

  constructor(
    private stream: AudioStream,
    duration: number,
  ) {
    const samples = Math.ceil(duration * SOURCE_SAMPLE_RATE);
    this.left = new Float32Array(samples);
    this.right = new Float32Array(samples);
  }

  get length() {
    return this.left.length;
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
    if (version === this.decodedVersion) return;
    this.decodedVersion = version;

    const ranges: Range[] = [];
    for (const run of groupIntoRuns(this.stream.getClusters())) {
      const song = await decodeRun(
        this.stream.header,
        run.map((cluster) => cluster.bytes),
      );

      const start = Math.round((run[0].startMs / 1000) * SOURCE_SAMPLE_RATE);
      const length = Math.min(song.length, this.length - start);
      if (length <= 0) continue;

      const left = song.getChannelData(0);
      const right = song.numberOfChannels > 1 ? song.getChannelData(1) : left;
      this.left.set(left.subarray(0, length), start);
      this.right.set(right.subarray(0, length), start);
      ranges.push({ start, end: start + length });
    }
    this.ranges = [...this.earlierRanges, ...ranges];
  }

  describe() {
    const seconds = (samples: number) =>
      (samples / SOURCE_SAMPLE_RATE).toFixed(1);
    const ranges = this.ranges
      .map((range) => `${seconds(range.start)}-${seconds(range.end)}`)
      .join(',');
    return `length=${seconds(this.length)} ranges=${ranges}`;
  }

  /** Whether a stretch of the song has arrived, allowing for its last moments. */
  has(start: number, end: number) {
    const target = Math.min(end, this.length - SOURCE_SAMPLE_RATE);
    return this.ranges.some(
      (range) => range.start <= start && range.end >= target,
    );
  }
}
