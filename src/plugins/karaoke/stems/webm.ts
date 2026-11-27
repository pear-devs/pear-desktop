/* oxlint-disable @stylistic/no-mixed-operators */
// Just enough WebM parsing to place audio in time. Clusters are the file's units
// of playback, and each one carries its start time.

const EBML_HEADER = 0x1a45dfa3;
const CLUSTER = 0x1f43b675;
const TIMECODE = 0xe7;
const SIMPLE_BLOCK = 0xa3;
const DURATION = 0x4489;
const TIMECODE_SCALE = 0x2ad7b1;

const DEFAULT_TIMECODE_SCALE = 1_000_000;
const OPUS_FRAME_MS = 20;

export type Chunk = {
  startMs: number;
  endMs: number;
  bytes: Uint8Array;
};

const readId = (bytes: Uint8Array, position: number) => {
  const first = bytes[position];
  if (first === undefined || first === 0) return null;

  const length = Math.clz32(first) - 23;
  if (position + length > bytes.length) return null;

  let id = 0;
  for (let i = 0; i < length; i++) id = id * 256 + bytes[position + i];
  return { id, length };
};

const readSize = (bytes: Uint8Array, position: number) => {
  const first = bytes[position];
  if (first === undefined || first === 0) return null;

  const length = Math.clz32(first) - 23;
  if (position + length > bytes.length) return null;

  let value = first & (0xff >> length);
  let isUnknown = value === 0xff >> length;
  for (let i = 1; i < length; i++) {
    const byte = bytes[position + i];
    value = value * 256 + byte;
    isUnknown &&= byte === 0xff;
  }
  return { value: isUnknown ? null : value, length };
};

const readUnsigned = (bytes: Uint8Array, start: number, length: number) => {
  let value = 0;
  for (let i = 0; i < length; i++) value = value * 256 + bytes[start + i];
  return value;
};

export const startsWithHeader = (bytes: Uint8Array) =>
  readId(bytes, 0)?.id === EBML_HEADER;

export const startsWithCluster = (bytes: Uint8Array) =>
  readId(bytes, 0)?.id === CLUSTER;

const SEGMENT = 0x18538067;

/**
 * Where the first cluster starts, for a header that arrives joined to its first
 * cluster. Walks the EBML header, then the segment's children, so bytes inside
 * other elements are never mistaken for a cluster.
 */
export const findClusterStart = (bytes: Uint8Array) => {
  let position = 0;
  while (position < bytes.length) {
    const id = readId(bytes, position);
    if (!id) return bytes.length;
    if (id.id === CLUSTER) return position;

    const size = readSize(bytes, position + id.length);
    if (!size) return bytes.length;
    const body = position + id.length + size.length;

    // Step into the segment, whose size may be unknown while it streams.
    if (id.id === SEGMENT || size.value === null) {
      position = body;
      continue;
    }
    position = body + size.value;
  }
  return bytes.length;
};

/** Reads the duration in seconds from a stream's header, when it has one. */
export const parseDuration = (header: Uint8Array) => {
  const view = new DataView(
    header.buffer,
    header.byteOffset,
    header.byteLength,
  );
  let scale = DEFAULT_TIMECODE_SCALE;
  let duration: number | null = null;

  for (let i = 0; i + 3 < header.length; i++) {
    const three = (header[i] << 16) | (header[i + 1] << 8) | header[i + 2];
    if (three === TIMECODE_SCALE) {
      const size = readSize(header, i + 3);
      const start = i + 3 + (size?.length ?? 0);
      // An unsigned integer is at most 8 bytes, and must fit in what arrived.
      if (
        size?.value &&
        size.value <= 8 &&
        start + size.value <= header.length
      ) {
        scale = readUnsigned(header, start, size.value) || scale;
      }
    }

    if (((header[i] << 8) | header[i + 1]) === DURATION) {
      const size = readSize(header, i + 2);
      const start = i + 2 + (size?.length ?? 0);
      if (size?.value === 8 && start + 8 <= header.length) {
        duration = view.getFloat64(start);
      } else if (size?.value === 4 && start + 4 <= header.length) {
        duration = view.getFloat32(start);
      }
    }
  }

  return duration === null ? null : (duration * scale) / 1e9;
};

const parseClusterTimes = (
  bytes: Uint8Array,
  bodyStart: number,
  bodyEnd: number,
) => {
  let time = 0;
  let lastBlock = 0;
  let position = bodyStart;

  while (position < bodyEnd) {
    const id = readId(bytes, position);
    if (!id) break;
    const size = readSize(bytes, position + id.length);
    if (!size || size.value === null) break;

    const data = position + id.length + size.length;
    if (id.id === TIMECODE) {
      time = readUnsigned(bytes, data, size.value);
    } else if (id.id === SIMPLE_BLOCK) {
      const track = readSize(bytes, data);
      if (track) {
        const high = bytes[data + track.length];
        const low = bytes[data + track.length + 1];
        lastBlock = ((high << 24) >> 16) | low;
      }
    }
    position = data + size.value;
  }

  return { startMs: time, endMs: time + lastBlock + OPUS_FRAME_MS };
};

/**
 * Takes every complete cluster from the front of `bytes`. Appends can split a
 * cluster, so whatever is left over must be retried with more data.
 */
export const takeClusters = (bytes: Uint8Array) => {
  const chunks: Chunk[] = [];
  let position = 0;

  while (position < bytes.length) {
    const id = readId(bytes, position);
    if (!id) break;
    const size = readSize(bytes, position + id.length);
    if (!size || size.value === null) break;

    const bodyStart = position + id.length + size.length;
    const bodyEnd = bodyStart + size.value;
    if (bodyEnd > bytes.length) break;

    if (id.id === CLUSTER) {
      chunks.push({
        ...parseClusterTimes(bytes, bodyStart, bodyEnd),
        bytes: bytes.slice(position, bodyEnd),
      });
    }
    position = bodyEnd;
  }

  return { chunks, rest: bytes.slice(position) };
};

/** Splits clusters into runs of unbroken audio. A seek leaves a gap. */
export const groupIntoRuns = (chunks: Chunk[], maxGapMs = 100) => {
  const sorted = [...chunks].sort((a, b) => a.startMs - b.startMs);
  const runs: Chunk[][] = [];

  for (const chunk of sorted) {
    const run = runs.at(-1);
    const previous = run?.at(-1);
    if (run && previous && chunk.startMs - previous.endMs <= maxGapMs) {
      run.push(chunk);
    } else {
      runs.push([chunk]);
    }
  }
  return runs;
};
