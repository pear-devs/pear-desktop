/* oxlint-disable @stylistic/no-mixed-operators */
// Just enough fragmented MP4 parsing to place AAC audio in time. Each fragment is
// a `moof` box describing its samples, followed by an `mdat` box holding them.

import type { Chunk } from './webm';

const FLAG_DEFAULT_DURATION = 0x08;
const FLAG_BASE_DATA_OFFSET = 0x01;
const FLAG_SAMPLE_DESCRIPTION = 0x02;
const FLAG_DATA_OFFSET = 0x01;
const FLAG_FIRST_SAMPLE_FLAGS = 0x04;
const FLAG_SAMPLE_DURATION = 0x100;
const FLAG_SAMPLE_SIZE = 0x200;
const FLAG_SAMPLE_FLAGS = 0x400;
const FLAG_SAMPLE_OFFSET = 0x800;

type Box = { type: string; start: number; body: number; end: number };

export type Mp4Info = {
  timescale: number;
  defaultSampleDuration: number;
  duration: number | null;
};

const view = (bytes: Uint8Array) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

const readUint64 = (data: DataView, position: number) =>
  data.getUint32(position) * 2 ** 32 + data.getUint32(position + 4);

const readBox = (bytes: Uint8Array, position: number, limit: number) => {
  if (position + 8 > limit) return null;

  const data = view(bytes);
  const type = String.fromCharCode(
    ...bytes.subarray(position + 4, position + 8),
  );
  let size = data.getUint32(position);
  let body = position + 8;

  if (size === 1) {
    if (position + 16 > limit) return null;
    size = readUint64(data, position + 8);
    body = position + 16;
  } else if (size === 0) {
    size = limit - position;
  }

  if (size < body - position) return null;
  return { type, start: position, body, end: position + size } satisfies Box;
};

const findBox = (
  bytes: Uint8Array,
  start: number,
  end: number,
  type: string,
): Box | null => {
  let position = start;
  while (position < end) {
    const box = readBox(bytes, position, end);
    if (!box || box.end > end) return null;
    if (box.type === type) return box;
    position = box.end;
  }
  return null;
};

const findPath = (bytes: Uint8Array, path: string[]) => {
  let box: Box | null = null;
  for (const type of path) {
    box = findBox(bytes, box?.body ?? 0, box?.end ?? bytes.length, type);
    if (!box) return null;
  }
  return box;
};

// `mvhd` and `mdhd` share a layout up to the duration.
const readTimes = (bytes: Uint8Array, box: Box) => {
  const data = view(bytes);
  const isLong = bytes[box.body] === 1;
  const timescale = data.getUint32(box.body + (isLong ? 20 : 12));
  const duration = isLong
    ? readUint64(data, box.body + 24)
    : data.getUint32(box.body + 16);
  return { timescale, duration };
};

export const isMp4Header = (bytes: Uint8Array) =>
  bytes.length >= 8 && readBox(bytes, 0, bytes.length)?.type === 'ftyp';

export const startsWithFragment = (bytes: Uint8Array) => {
  const type = readBox(bytes, 0, bytes.length)?.type;
  return type === 'moof' || type === 'styp';
};

/** Where the media starts, for a header that arrives joined to its first fragment. */
export const findHeaderEnd = (bytes: Uint8Array) => {
  let position = 0;
  while (position < bytes.length) {
    const box = readBox(bytes, position, bytes.length);
    if (!box || box.type === 'moof' || box.type === 'styp') return position;
    position = box.end;
  }
  return bytes.length;
};

export const parseMp4Header = (header: Uint8Array): Mp4Info => {
  const data = view(header);
  const movie = findPath(header, ['moov', 'mvhd']);
  const media = findPath(header, ['moov', 'trak', 'mdia', 'mdhd']);
  const extends_ = findPath(header, ['moov', 'mvex', 'mehd']);
  const trackExtends = findPath(header, ['moov', 'mvex', 'trex']);

  const movieTimes = movie ? readTimes(header, movie) : null;
  const mediaTimes = media ? readTimes(header, media) : null;

  let fragmentDuration = 0;
  if (extends_) {
    fragmentDuration =
      header[extends_.body] === 1
        ? readUint64(data, extends_.body + 4)
        : data.getUint32(extends_.body + 4);
  }

  const seconds = [
    movieTimes && fragmentDuration / movieTimes.timescale,
    movieTimes && movieTimes.duration / movieTimes.timescale,
    mediaTimes && mediaTimes.duration / mediaTimes.timescale,
  ].find((value) => value && value > 0 && Number.isFinite(value));

  return {
    timescale: mediaTimes?.timescale ?? movieTimes?.timescale ?? 1000,
    defaultSampleDuration: trackExtends
      ? data.getUint32(trackExtends.body + 12)
      : 0,
    duration: seconds ?? null,
  };
};

const parseTimes = (bytes: Uint8Array, moof: Box, info: Mp4Info) => {
  const data = view(bytes);
  const fragment = findBox(bytes, moof.body, moof.end, 'traf');
  if (!fragment) return null;

  const decodeTime = findBox(bytes, fragment.body, fragment.end, 'tfdt');
  const trackHeader = findBox(bytes, fragment.body, fragment.end, 'tfhd');
  const samples = findBox(bytes, fragment.body, fragment.end, 'trun');
  if (!decodeTime || !trackHeader || !samples) return null;

  const start =
    bytes[decodeTime.body] === 1
      ? readUint64(data, decodeTime.body + 4)
      : data.getUint32(decodeTime.body + 4);

  let defaultDuration = info.defaultSampleDuration;
  const headerFlags = data.getUint32(trackHeader.body) & 0xffffff;
  if (headerFlags & FLAG_DEFAULT_DURATION) {
    let position = trackHeader.body + 8;
    if (headerFlags & FLAG_BASE_DATA_OFFSET) position += 8;
    if (headerFlags & FLAG_SAMPLE_DESCRIPTION) position += 4;
    defaultDuration = data.getUint32(position);
  }

  const flags = data.getUint32(samples.body) & 0xffffff;
  const count = data.getUint32(samples.body + 4);
  let position = samples.body + 8;
  if (flags & FLAG_DATA_OFFSET) position += 4;
  if (flags & FLAG_FIRST_SAMPLE_FLAGS) position += 4;

  let total = 0;
  if (flags & FLAG_SAMPLE_DURATION) {
    const fieldSize =
      4 +
      (flags & FLAG_SAMPLE_SIZE ? 4 : 0) +
      (flags & FLAG_SAMPLE_FLAGS ? 4 : 0) +
      (flags & FLAG_SAMPLE_OFFSET ? 4 : 0);
    for (let i = 0; i < count; i++) {
      total += data.getUint32(position + i * fieldSize);
    }
  } else {
    total = count * defaultDuration;
  }

  const toMs = (value: number) => (value / info.timescale) * 1000;
  return { startMs: toMs(start), endMs: toMs(start + total) };
};

/**
 * Takes every complete fragment from the front of `bytes`. Appends can split a
 * fragment, so whatever is left over must be retried with more data.
 */
export const takeFragments = (bytes: Uint8Array, info: Mp4Info) => {
  const chunks: Chunk[] = [];
  let position = 0;
  let consumed = 0;
  let moof: Box | null = null;

  while (position < bytes.length) {
    const box = readBox(bytes, position, bytes.length);
    if (!box || box.end > bytes.length) break;

    if (box.type === 'moof') {
      moof = box;
    } else if (box.type === 'mdat' && moof) {
      const times = parseTimes(bytes, moof, info);
      if (times) {
        chunks.push({ ...times, bytes: bytes.slice(moof.start, box.end) });
      }
      moof = null;
      consumed = box.end;
    } else if (!moof) {
      consumed = box.end;
    }
    position = box.end;
  }

  return { chunks, rest: bytes.slice(consumed) };
};
