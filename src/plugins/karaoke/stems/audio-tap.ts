import { type AudioStream, StreamList } from './audio-streams';
import { log } from './diagnostics';
import { findHeaderEnd, isMp4Header } from './mp4';
import { startsWithHeader } from './webm';

const isCapturedType = (type: string) =>
  type.startsWith('audio/webm') || type.startsWith('audio/mp4');

let isCapturing = false;
const streams = new StreamList();
const audioBuffers = new WeakMap<SourceBuffer, AudioStream | null>();

const capture = (buffer: SourceBuffer, data: BufferSource) => {
  const view = ArrayBuffer.isView(data)
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : new Uint8Array(data);

  if (startsWithHeader(view)) {
    const stream = streams.open(view.slice());
    stream.timeOffset = buffer.timestampOffset;
    audioBuffers.set(buffer, stream);
    log(`stream starts at offset ${buffer.timestampOffset}`);
    return;
  }

  if (isMp4Header(view)) {
    const headerEnd = findHeaderEnd(view);
    const stream = streams.open(view.slice(0, headerEnd));
    stream.timeOffset = buffer.timestampOffset;
    audioBuffers.set(buffer, stream);
    log(`stream starts at offset ${buffer.timestampOffset}`);
    if (headerEnd < view.length) stream.append(view.subarray(headerEnd));
    return;
  }

  const stream = audioBuffers.get(buffer);
  if (!stream) log(`audio with no stream, ${view.length} bytes`);
  stream?.append(view);
};

// These must be in place before the player starts, because the first thing it
// appends is the header that everything after depends on. This module is loaded
// before the page's own scripts. Audio is only kept while capturing is on.
// oxlint-disable-next-line typescript/unbound-method
const addSourceBuffer = MediaSource.prototype.addSourceBuffer;
MediaSource.prototype.addSourceBuffer = function (type: string) {
  const buffer = addSourceBuffer.call(this, type);
  if (type.startsWith('audio/')) log(`source buffer ${type}`);
  if (isCapturedType(type)) audioBuffers.set(buffer, null);
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

// oxlint-disable-next-line typescript/unbound-method
const changeType = SourceBuffer.prototype.changeType;
SourceBuffer.prototype.changeType = function (type: string) {
  if (audioBuffers.has(this)) {
    log(`source buffer changed to ${type}`);
    // What comes next is in another format, and must not reach the old stream.
    audioBuffers.set(this, null);
  }
  changeType.call(this, type);
};

export const describeStreams = () => streams.describe();

export const setCapturing = (value: boolean) => {
  isCapturing = value;
  if (!value) streams.clear();
};

export const hasStreams = () => !streams.isEmpty;

export const findStream = (duration: number) => streams.find(duration);

// The header arrives before plugins start, so this cannot wait for them.
try {
  const config = window.mainConfig?.plugins.getPlugins().karaoke as
    | { enabled?: boolean; aiVocals?: boolean }
    | undefined;
  isCapturing = Boolean(config?.enabled && config.aiVocals);
} catch {
  isCapturing = false;
}
