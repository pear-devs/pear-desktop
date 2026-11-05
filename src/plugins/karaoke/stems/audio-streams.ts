import { log } from './diagnostics';
import {
  isMp4Header,
  parseMp4Header,
  startsWithFragment,
  takeFragments,
} from './mp4';
import {
  type Chunk,
  parseDuration,
  startsWithCluster,
  takeClusters,
} from './webm';

type Format = {
  name: string;
  duration: number | null;
  startsChunk: (bytes: Uint8Array) => boolean;
  take: (bytes: Uint8Array) => { chunks: Chunk[]; rest: Uint8Array };
};

const readFormat = (header: Uint8Array): Format => {
  if (isMp4Header(header)) {
    const info = parseMp4Header(header);
    return {
      name: 'mp4',
      duration: info.duration,
      startsChunk: startsWithFragment,
      take: (bytes) => takeFragments(bytes, info),
    };
  }

  return {
    name: 'webm',
    duration: parseDuration(header),
    startsChunk: startsWithCluster,
    take: takeClusters,
  };
};

// Enough to tell a song from an ad, without tripping over rounding.
const DURATION_TOLERANCE_SECONDS = 1.5;

// Ads and preloading both add streams, and the song being played must survive
// them. Each stream only holds a few megabytes of compressed audio.
const STREAMS_KEPT = 6;

const LARGE_PENDING_BYTES = 1024 * 1024;

const isSameHeader = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, index) => byte === b[index]);

/** One piece of media the player is loading, such as an ad or a song. */
export class AudioStream {
  /** Goes up whenever there is new audio. */
  version = 0;
  /** Seconds the player shifts this stream by. AAC starts slightly early. */
  timeOffset = 0;
  readonly duration: number | null;
  private readonly format: Format;
  private readonly chunks = new Map<number, Chunk>();
  private pending: Uint8Array = new Uint8Array();
  private reportedPending = 0;

  constructor(readonly header: Uint8Array) {
    this.format = readFormat(header);
    this.duration = this.format.duration;
  }

  append(bytes: Uint8Array) {
    // The player can abandon a chunk part way through, after a seek. What it
    // left behind must go, or everything after it would be misread.
    if (this.format.startsChunk(bytes)) this.pending = new Uint8Array();

    const joined = new Uint8Array(this.pending.length + bytes.length);
    joined.set(this.pending);
    joined.set(bytes, this.pending.length);

    const { chunks, rest } = this.format.take(joined);
    this.pending = rest;

    for (const chunk of chunks) {
      this.chunks.set(chunk.startMs, chunk);
      this.version++;
    }

    if (
      rest.length > LARGE_PENDING_BYTES &&
      rest.length > this.reportedPending
    ) {
      this.reportedPending = rest.length;
      log(`stream ${this.duration} stuck with ${rest.length} unread bytes`);
    }
  }

  describe() {
    const times = this.getChunks()
      .map((chunk) => chunk.startMs)
      .sort((a, b) => a - b);
    return `format=${this.format.name} duration=${this.duration} chunks=${times.length} first=${times[0]} last=${times.at(-1)} pending=${this.pending.length}`;
  }

  getChunks() {
    return [...this.chunks.values()];
  }

  get formatName() {
    return this.format.name;
  }
}

export class StreamList {
  private streams: AudioStream[] = [];

  /**
   * The player sends a header again when it restarts a stream part way through a
   * song, so a repeated header continues the stream it belongs to.
   */
  open(header: Uint8Array) {
    const existing = this.streams.find((stream) =>
      isSameHeader(stream.header, header),
    );
    const stream = existing ?? new AudioStream(header);
    log(
      `header ${stream.formatName} ${header.length} bytes, duration ${stream.duration}, ${existing ? 'repeated' : 'new'}`,
    );

    this.streams = this.streams.filter((other) => other !== stream);
    this.streams.push(stream);
    if (this.streams.length > STREAMS_KEPT) this.streams.shift();
    return stream;
  }

  /** The most recently opened stream that matches the length of the song. */
  find(duration: number) {
    for (let i = this.streams.length - 1; i >= 0; i--) {
      const stream = this.streams[i];
      if (
        stream.duration === null ||
        Math.abs(stream.duration - duration) < DURATION_TOLERANCE_SECONDS
      ) {
        return stream;
      }
    }
    return null;
  }

  describe() {
    return this.streams.map((stream) => `[${stream.describe()}]`).join(' ');
  }

  get isEmpty() {
    return this.streams.length === 0;
  }

  clear() {
    this.streams = [];
  }
}
