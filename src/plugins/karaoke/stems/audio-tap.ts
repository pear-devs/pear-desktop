import {
  type Cluster,
  parseDuration,
  startsWithHeader,
  takeClusters,
} from './webm';

// Enough to tell a song from an ad, without tripping over rounding.
const DURATION_TOLERANCE_SECONDS = 1.5;
const STREAMS_KEPT = 3;

/** One piece of media the player is loading, such as an ad or a song. */
export class AudioStream {
  /** Goes up whenever there is new audio. */
  version = 0;
  readonly duration: number | null;
  private readonly clusters = new Map<number, Cluster>();
  private pending = new Uint8Array();

  constructor(readonly header: Uint8Array) {
    this.duration = parseDuration(header);
  }

  append(bytes: Uint8Array) {
    const joined = new Uint8Array(this.pending.length + bytes.length);
    joined.set(this.pending);
    joined.set(bytes, this.pending.length);

    const { clusters, rest } = takeClusters(joined);
    this.pending = rest;

    for (const cluster of clusters) {
      this.clusters.set(cluster.startMs, cluster);
      this.version++;
    }
  }

  getClusters() {
    return [...this.clusters.values()];
  }
}

let isCapturing = false;
const streams: AudioStream[] = [];
const audioBuffers = new WeakMap<SourceBuffer, AudioStream | null>();

const capture = (buffer: SourceBuffer, data: BufferSource) => {
  const view = ArrayBuffer.isView(data)
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : new Uint8Array(data);

  if (startsWithHeader(view)) {
    const stream = new AudioStream(view.slice());
    audioBuffers.set(buffer, stream);
    streams.push(stream);
    if (streams.length > STREAMS_KEPT) streams.shift();
    return;
  }

  audioBuffers.get(buffer)?.append(view);
};

// These must be in place before the player starts, because the first thing it
// appends is the header that everything after depends on. This module is loaded
// before the page's own scripts. Audio is only kept while capturing is on.
// oxlint-disable-next-line typescript/unbound-method
const addSourceBuffer = MediaSource.prototype.addSourceBuffer;
MediaSource.prototype.addSourceBuffer = function (type: string) {
  const buffer = addSourceBuffer.call(this, type);
  if (type.startsWith('audio/webm')) audioBuffers.set(buffer, null);
  return buffer;
};

// oxlint-disable-next-line typescript/unbound-method
const appendBuffer = SourceBuffer.prototype.appendBuffer;
SourceBuffer.prototype.appendBuffer = function (data: BufferSource) {
  if (isCapturing && audioBuffers.has(this)) {
    try {
      capture(this, data);
    } catch (error) {
      // Playback must carry on whatever happens here.
      console.error('[karaoke] Could not read audio:', error);
    }
  }
  appendBuffer.call(this, data);
};

export const setCapturing = (value: boolean) => {
  isCapturing = value;
  if (!value) streams.length = 0;
};

export const hasStreams = () => streams.length > 0;

/** The newest stream that matches the length of what is playing. */
export const findStream = (duration: number) => {
  for (let i = streams.length - 1; i >= 0; i--) {
    const stream = streams[i];
    if (
      stream.duration === null ||
      Math.abs(stream.duration - duration) < DURATION_TOLERANCE_SECONDS
    ) {
      return stream;
    }
  }
  return null;
};

// The header arrives before plugins start, so this cannot wait for them.
try {
  const config = window.mainConfig?.plugins.getPlugins().karaoke as
    | { enabled?: boolean; aiVocals?: boolean }
    | undefined;
  isCapturing = Boolean(config?.enabled && config.aiVocals);
} catch {
  isCapturing = false;
}
