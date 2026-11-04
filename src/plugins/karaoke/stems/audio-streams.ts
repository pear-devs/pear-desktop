import { log } from './diagnostics';
import {
  type Cluster,
  parseDuration,
  startsWithCluster,
  takeClusters,
} from './webm';

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
  readonly duration: number | null;
  private readonly clusters = new Map<number, Cluster>();
  private pending = new Uint8Array();
  private reportedPending = 0;

  constructor(readonly header: Uint8Array) {
    this.duration = parseDuration(header);
  }

  append(bytes: Uint8Array) {
    // The player can abandon a cluster part way through, after a seek. What it
    // left behind must go, or everything after it would be misread.
    if (startsWithCluster(bytes)) this.pending = new Uint8Array();

    const joined = new Uint8Array(this.pending.length + bytes.length);
    joined.set(this.pending);
    joined.set(bytes, this.pending.length);

    const { clusters, rest } = takeClusters(joined);
    this.pending = rest;

    for (const cluster of clusters) {
      this.clusters.set(cluster.startMs, cluster);
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
    const times = this.getClusters()
      .map((cluster) => cluster.startMs)
      .sort((a, b) => a - b);
    return `duration=${this.duration} clusters=${times.length} first=${times[0]} last=${times.at(-1)} pending=${this.pending.length}`;
  }

  getClusters() {
    return [...this.clusters.values()];
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
      `header ${header.length} bytes, duration ${stream.duration}, ${existing ? 'repeated' : 'new'}`,
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
