// Pure, dependency-free logic (no DOM / canvas / Web Audio), so it can be unit-tested
// directly. index.ts does the rendering/IO and delegates the maths here.

/** Result of carving an init segment out of captured bytes. */
export interface InitExtract {
  /** True once the complete init segment is available in `init`. */
  complete: boolean;
  /** The init bytes (a prefix of the input when complete). */
  init: Uint8Array;
}

const boxTypeAt = (u8: Uint8Array, off: number): string =>
  String.fromCharCode(u8[off + 4], u8[off + 5], u8[off + 6], u8[off + 7]);

// EBML element IDs relevant to the WebM init segment (Segment children we skip are
// handled generically).
const EBML_ID = [0x1a, 0x45, 0xdf, 0xa3];
const SEGMENT_ID = [0x18, 0x53, 0x80, 0x67];
const INFO_ID = [0x15, 0x49, 0xa9, 0x66];
const TRACKS_ID = [0x16, 0x54, 0xae, 0x6b];
const CLUSTER_ID = [0x1f, 0x43, 0xb6, 0x75];

const matchBytes = (u8: Uint8Array, off: number, id: number[]): boolean => {
  for (let i = 0; i < id.length; i++) {
    if (off + i >= u8.length || u8[off + i] !== id[i]) return false;
  }
  return true;
};

/** Read an EBML variable-length integer. Returns null when truncated or invalid. */
const readVint = (
  u8: Uint8Array,
  off: number,
): { len: number; value: number; unknown: boolean } | null => {
  if (off >= u8.length) return null;
  const first = u8[off];
  let len = 1;
  let marker = 0x80;
  while (len <= 8 && (first & marker) === 0) {
    len++;
    marker >>= 1;
  }
  if (len > 8 || off + len > u8.length) return null;
  let value = first & (marker - 1);
  for (let i = 1; i < len; i++) value = value * 256 + u8[off + i];
  return { len, value, unknown: value === 2 ** (7 * len) - 1 };
};

/** Length in bytes of the EBML element ID at `off` (1-4), or null if truncated/invalid. */
const idLenAt = (u8: Uint8Array, off: number): number | null => {
  if (off >= u8.length) return null;
  const first = u8[off];
  if (first === 0) return null;
  let len = 1;
  let marker = 0x80;
  while (len <= 4 && (first & marker) === 0) {
    len++;
    marker >>= 1;
  }
  if (len > 4 || off + len > u8.length) return null;
  return len;
};

/**
 * Carve a complete WebM init segment out of captured bytes: the EBML header, the Segment
 * header, and complete Info and Tracks elements. Cuts before the first Cluster so media
 * never lands in the cached init (prepending a media cluster to a later run would replay
 * it). Returns incomplete while any required part is truncated — feed more bytes. An
 * unparseable layout falls back to `whole` (previous behaviour for unrecognised streams).
 */
const extractWebmInit = (bytes: Uint8Array): InitExtract => {
  const whole = { complete: true, init: bytes };
  const needMore = { complete: false, init: bytes };
  // 1. EBML header: ID(4) + size(vint) + body must all be present.
  if (!matchBytes(bytes, 0, EBML_ID)) return whole; // unreachable: caller checked magic
  const ebmlSize = readVint(bytes, 4);
  if (!ebmlSize) return needMore;
  if (ebmlSize.unknown) return whole; // can't delimit an unbounded header element
  if (4 + ebmlSize.len + ebmlSize.value > bytes.length) return needMore;
  let pos = 4 + ebmlSize.len + ebmlSize.value;
  // 2. A Segment header must follow the EBML header.
  if (!matchBytes(bytes, pos, SEGMENT_ID)) return needMore;
  const segSize = readVint(bytes, pos + 4);
  if (!segSize) return needMore;
  const scanEnd = segSize.unknown
    ? bytes.length
    : Math.min(bytes.length, pos + 4 + segSize.len + segSize.value);
  pos += 4 + segSize.len;
  // 3. Scan level-1 children for complete Info and Tracks; stop at the first Cluster,
  // which is where media starts — the init must end before it.
  let infoEnd = -1;
  let tracksEnd = -1;
  while (pos < scanEnd) {
    // Required init already complete: return before interpreting anything that follows
    // (Void/CRC/Cluster) — a Void spanning appends must not keep us "incomplete".
    if (infoEnd >= 0 && tracksEnd >= 0) {
      return { complete: true, init: bytes.slice(0, Math.max(infoEnd, tracksEnd)) };
    }
    if (matchBytes(bytes, pos, CLUSTER_ID)) break;
    const idLen = idLenAt(bytes, pos);
    if (idLen === null) return needMore;
    const size = readVint(bytes, pos + idLen);
    if (!size || size.unknown) return needMore;
    const end = pos + idLen + size.len + size.value;
    if (end > scanEnd) return needMore;
    if (matchBytes(bytes, pos, INFO_ID)) infoEnd = end;
    else if (matchBytes(bytes, pos, TRACKS_ID)) tracksEnd = end;
    pos = end;
  }
  if (infoEnd < 0 || tracksEnd < 0) return needMore;
  return { complete: true, init: bytes.slice(0, Math.max(infoEnd, tracksEnd)) };
};

/**
 * Carve the complete fMP4 init segment (`ftyp` + `moov`) out of captured bytes.
 * The first append of a track is usually exactly that, but MSE also allows one append
 * to hold `ftyp` + `moov` + the first media fragment (the trailing media must not be
 * cached — prepending it to a later run would replay the first fragment), and an init
 * segment to span several appends (caching a partial header seeds runs that can never
 * decode). So: return `complete: false` while the `moov` box is truncated (feed more
 * bytes), and slice any media after `moov` off. Anything we don't positively recognise
 * as fMP4 (WebM, an unexpected box order) is returned whole, preserving the previous
 * behaviour for those streams.
 */
export const extractInitSegment = (bytes: Uint8Array): InitExtract => {
  const whole = { complete: true, init: bytes };
  // Need at least the 4-byte magic to identify the container format.
  if (bytes.length < 4) return { complete: false, init: bytes };
  // WebM (EBML header): parse the header, Segment, Info and Tracks below.
  if (matchBytes(bytes, 0, EBML_ID)) return extractWebmInit(bytes);
  // Too short to even hold a box header: the type can't be identified yet (a lone size
  // field is not an init). Keep it pending until more bytes arrive — caching it now would
  // seed later runs with an undecodable stub.
  if (bytes.length < 8) return { complete: false, init: bytes };
  if (boxTypeAt(bytes, 0) !== 'ftyp') return whole;
  let off = 0;
  let seenFtyp = false;
  for (;;) {
    if (off + 8 > bytes.length) return { complete: false, init: bytes }; // truncated header
    const u32 =
      (bytes[off] << 24) |
      (bytes[off + 1] << 16) |
      (bytes[off + 2] << 8) |
      bytes[off + 3];
    const type = boxTypeAt(bytes, off);
    let size = u32;
    let hdr = 8;
    if (u32 === 1) {
      // largesize: 64-bit box size follows the type.
      if (off + 16 > bytes.length) return { complete: false, init: bytes };
      const hi =
        (bytes[off + 8] << 24) |
        (bytes[off + 9] << 16) |
        (bytes[off + 10] << 8) |
        bytes[off + 11];
      const lo =
        (bytes[off + 12] << 24) |
        (bytes[off + 13] << 16) |
        (bytes[off + 14] << 8) |
        bytes[off + 15];
      size = hi * 2 ** 32 + lo;
      hdr = 16;
    } else if (u32 === 0) {
      size = bytes.length - off; // box extends to the end
    }
    if (size < hdr) return whole; // corrupt — don't try to be clever
    if (type === 'ftyp') seenFtyp = true;
    else if (type === 'moov') {
      if (!seenFtyp) return whole;
      if (off + size > bytes.length) return { complete: false, init: bytes }; // partial moov
      return { complete: true, init: bytes.slice(0, off + size) };
    } else if (type === 'moof' || type === 'mdat') {
      // Media before any `moov`: not a clean init-first stream — keep previous behaviour.
      return whole;
    }
    // Unknown setup box (e.g. `styp`, `sidx`): include it and keep looking for `moov`.
    if (off + size > bytes.length) return { complete: false, init: bytes };
    off += size;
    if (off >= bytes.length) return { complete: false, init: bytes }; // ran out before moov
  }
};
/** fMP4 init segments start with an `ftyp` box; WebM with the EBML header. */
export const looksLikeInitSegment = (u8: Uint8Array): boolean => {
  if (
    u8.length >= 8 &&
    u8[4] === 0x66 && // f
    u8[5] === 0x74 && // t
    u8[6] === 0x79 && // y
    u8[7] === 0x70 // p
  ) {
    return true;
  }
  if (
    u8.length >= 4 &&
    u8[0] === 0x1a &&
    u8[1] === 0x45 &&
    u8[2] === 0xdf &&
    u8[3] === 0xa3
  ) {
    return true;
  }
  return false;
};

// ─── timeline position maths (unit-tested; drives where decoded audio lands) ──

/** The bucket index [0, res) for a playback progress fraction (0..1), clamped. */
export const bucketForProgress = (progress: number, res: number): number =>
  Math.min(res - 1, Math.max(0, Math.floor(progress * res)));

/**
 * A run of decoded audio starts at `startSec` on the track and lasts `durationSec`.
 * Returns the [start, end) timeline-bucket range it fills. Clamped to [0, res].
 */
export const runBucketRange = (
  startSec: number,
  durationSec: number,
  trackDurSec: number,
  res: number,
): { start: number; end: number } => {
  if (trackDurSec <= 0 || res <= 0) return { start: 0, end: 0 };
  const bucketDur = trackDurSec / res;
  const start = Math.min(res, Math.max(0, Math.floor(startSec / bucketDur)));
  const end = Math.min(
    res,
    Math.max(0, Math.ceil((startSec + durationSec) / bucketDur)),
  );
  return { start, end: Math.max(start, end) };
};

/**
 * Fraction (0..1) of the already-played region [0, playedRes] that has data —
 * definitive decoded buckets (`filled`) or provisional live/partial ones (`live`).
 * Returns 1 when nothing has played yet, so an idle/just-started track never looks
 * "uncovered". Used to detect the resumed/cached case where the progressive path
 * captured nothing.
 */
export const playedCoverage = (
  filled: Uint8Array,
  live: Uint8Array,
  playedRes: number,
): number => {
  if (playedRes <= 0) return 1;
  const end = Math.min(filled.length - 1, playedRes);
  if (end < 0) return 1;
  let n = 0;
  for (let i = 0; i <= end; i++)
    if (filled[i] || (i < live.length && live[i])) n++;
  return n / (end + 1);
};

/**
 * Whether to auto-fetch the whole track as a fallback: the track has been playing
 * long enough that the progressive path should have data, yet the played region is
 * almost entirely undecoded (resumed mid-track / cached with no capture / missed
 * buffer). Kept pure and tuneable so the trigger is unit-tested.
 */
export const shouldAutoFetchFull = (
  coverage: number,
  elapsedMs: number,
  opts: { minElapsedMs?: number; maxCoverage?: number } = {},
): boolean => {
  const minElapsedMs = opts.minElapsedMs ?? 4000;
  const maxCoverage = opts.maxCoverage ?? 0.15;
  return elapsedMs >= minElapsedMs && coverage < maxCoverage;
};

/**
 * The [start, end) sample window inside a run's decoded audio that corresponds to
 * timeline bucket `bucket`. Returns null if the bucket falls outside the run's audio.
 */
export const sampleWindowForBucket = (
  bucket: number,
  runStartSec: number,
  trackDurSec: number,
  res: number,
  sampleRate: number,
  sampleLen: number,
): { start: number; end: number } | null => {
  if (trackDurSec <= 0 || res <= 0) return null;
  const bucketDur = trackDurSec / res;
  // Convert both ABSOLUTE bucket boundaries to run-relative sample indices with the same
  // rounding, so adjacent buckets share their boundary exactly: no skipped samples between
  // buckets, and no reading past the end of a bucket the run starts inside of.
  const tEnd = (bucket + 1) * bucketDur;
  if (tEnd <= runStartSec) return null; // wholly before this run
  const tStart = bucket * bucketDur;
  const start = Math.max(0, Math.floor((tStart - runStartSec) * sampleRate));
  const end = Math.min(sampleLen, Math.floor((tEnd - runStartSec) * sampleRate));
  if (start >= sampleLen || end <= start) return null;
  return { start, end };
};

/** Byte-wise equality (used to tell an exact init duplicate from a replacement). */
export const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

/** True when `suffix` is a byte-exact tail of `buf` (used to detect a chunk that was
 *  already consumed into the assembled init segment). */
export const endsWithBytes = (buf: Uint8Array, suffix: Uint8Array): boolean => {
  if (suffix.length === 0 || suffix.length > buf.length) return false;
  const off = buf.length - suffix.length;
  for (let i = 0; i < suffix.length; i++) if (buf[off + i] !== suffix[i]) return false;
  return true;
};

/**
 * If `u8` starts with the cached init segment, return the remaining media bytes; if it
 * matches the cached init exactly, return an empty suffix (an exact duplicate, not a
 * replacement). Returns null when `u8` is shorter than the init (unverifiable) or differs
 * from it (only a complete replacement init elsewhere justifies a fresh run).
 */
export const stripDuplicateInit = (
  u8: Uint8Array,
  init: Uint8Array,
): Uint8Array | null => {
  if (init.length === 0 || u8.length < init.length) return null;
  for (let i = 0; i < init.length; i++) if (u8[i] !== init[i]) return null;
  return u8.slice(init.length);
};

const FRAGMENT_BOXES = new Set([
  // A new fragment (or file/initialization) header: cutting here leaves the continuation
  // starting on decodable data. `mdat` is deliberately NOT a boundary — it continues the
  // previous `moof`, so cutting at an `mdat` would orphan the media from the header that
  // describes it. Init boxes stay cut points: an init append announces a discontinuity.
  'moof',
  'moov',
  'ftyp',
  'styp',
  'sidx',
  'emsg',
  'prft',
  'mfra',
  'skip',
]);

/**
 * Whether a chunk plausibly starts at a media-fragment boundary (an fMP4 box header or a
 * WebM Cluster ID), so cutting a run here leaves the continuation starting on decodable
 * data. Used to defer the byte-cap rollover past a split mdat instead of severing the
 * run mid-fragment (the init-seeded continuation could not decode those bytes).
 */
export const startsAtFragmentBoundary = (u8: Uint8Array): boolean => {
  // WebM Cluster ID (0x1F43B675): a independently-decodable cluster starts here.
  if (
    u8.length >= 4 &&
    u8[0] === 0x1f &&
    u8[1] === 0x43 &&
    u8[2] === 0xb6 &&
    u8[3] === 0x75
  ) {
    return true;
  }
  if (u8.length < 8) return false;
  const u32 = (u8[0] << 24) | (u8[1] << 16) | (u8[2] << 8) | u8[3];
  if (u32 === 1) {
    // 64-bit largesize: the real size follows the type field, so 16 header bytes are
    // needed before the type can be read. (A plain 4-byte `size` of 1 is never valid.)
    if (u8.length < 16) return false;
  } else if (u32 !== 0 && u32 < 8) {
    return false;
  }
  return FRAGMENT_BOXES.has(boxTypeAt(u8, 0));
};

export interface BucketAnalysis {
  /** RMS amplitude across channels (0..1) — drives colour/band energy. */
  rms: number;
  /** True peak (max |sample|) across channels (0..1) — drives the drawn height, giving the
   *  dense, transient-rich envelope (kicks spike) of a Rekordbox/SoundCloud waveform. */
  peak: number;
  /** Rough low-band energy (bass). */
  low: number;
  /** Rough mid-band energy. */
  mid: number;
  /** Rough high-band energy (transients). */
  high: number;
}

/**
 * Analyse one time-slice [start, end) of decoded audio: overall RMS across channels, plus
 * a proper 3-band split on channel 0 using two one-pole low-passes (so each band is well
 * separated, which is what makes the Rekordbox-RGB colour track the actual frequency
 * content instead of smearing toward one hue):
 *   - low  = energy below ~210 Hz        (bass/kick → red)
 *   - mid  = energy ~210 Hz … ~1.5 kHz   (vocals/synths → green) — band-pass between cutoffs
 *   - high = energy above ~1.5 kHz       (hats/air → blue)
 * Cutoffs are the one-pole coefficients at a nominal 44.1 kHz (the exact Hz drift with
 * sample rate, which is fine for a colour cue).
 */
export const analyzeBucket = (
  channels: Float32Array[],
  start: number,
  end: number,
): BucketAnalysis => {
  const n = Math.max(1, end - start);
  const chans = Math.min(2, channels.length);

  let sumSq = 0;
  let peak = 0;
  for (let c = 0; c < chans; c++) {
    const d = channels[c];
    for (let j = start; j < end; j++) {
      const v = d[j];
      sumSq += v * v;
      const av = v < 0 ? -v : v;
      if (av > peak) peak = av;
    }
  }
  const rms = Math.sqrt(sumSq / (n * chans));

  const A_LOW = 0.03; // ~210 Hz cutoff
  const A_MID = 0.22; // ~1.5 kHz cutoff
  let sLo = 0;
  let sMid = 0;
  let sHi = 0;
  // Filter EACH channel and SUM the energies (not the raw samples — summing samples would
  // cancel out-of-phase content). A one-sided panned signal (e.g. a cymbal only on the right)
  // then still contributes its band energy instead of reading as silence, which would have
  // drawn a black column for audible content.
  for (let c = 0; c < chans; c++) {
    const d = channels[c];
    let lpLow = d[start];
    let lpMid = d[start];
    for (let j = start; j < end; j++) {
      const s = d[j];
      lpLow += A_LOW * (s - lpLow);
      lpMid += A_MID * (s - lpMid);
      const low = lpLow; // below the low cutoff
      const mid = lpMid - lpLow; // between the two cutoffs
      const high = s - lpMid; // above the mid cutoff
      sLo += low * low;
      sMid += mid * mid;
      sHi += high * high;
    }
  }
  const bandNorm = n * chans;
  return {
    rms,
    peak,
    low: Math.sqrt(sLo / bandNorm),
    mid: Math.sqrt(sMid / bandNorm),
    high: Math.sqrt(sHi / bandNorm),
  };
};

export interface FullPeaks {
  /** RMS per timeline bucket (length `res`), raw — scale by `peakScale` to draw. */
  peaks: Float32Array;
  /** True peak per timeline bucket (length `res`) — the drawn-height source (transient-rich). */
  peaksMax: Float32Array;
  /** Low/mid/high energy per bucket (length `res * 3`). */
  bands: Float32Array;
  /** 1 where a bucket had samples (length `res`). */
  filled: Uint8Array;
  /** Multiplier so the loudest bucket ≈ `target`, giving a SoundCloud-style normalized strip. */
  peakScale: number;
}

/**
 * Decode-once path (opt-in "full waveform"): analyse a whole decoded track into every
 * timeline bucket and return a per-track normalization factor. Pure so both the
 * progressive and full paths can be unit-tested without Web Audio.
 */
export const computeFullPeaks = (
  channels: Float32Array[],
  sampleRate: number,
  durationSec: number,
  res: number,
  target = 0.92,
): FullPeaks => {
  const peaks = new Float32Array(res);
  const peaksMax = new Float32Array(res);
  const bands = new Float32Array(res * 3);
  const filled = new Uint8Array(res);
  const len = channels[0]?.length ?? 0;
  let maxRms = 0;
  for (let b = 0; b < res; b++) {
    const win = sampleWindowForBucket(b, 0, durationSec, res, sampleRate, len);
    if (!win || win.end <= win.start) continue;
    const a = analyzeBucket(channels, win.start, win.end);
    peaks[b] = a.rms;
    peaksMax[b] = a.peak;
    const bi = b * 3;
    bands[bi] = a.low;
    bands[bi + 1] = a.mid;
    bands[bi + 2] = a.high;
    filled[b] = 1;
    if (a.rms > maxRms) maxRms = a.rms;
  }
  const peakScale = maxRms > 0 ? target / maxRms : 1;
  return { peaks, peaksMax, bands, filled, peakScale };
};

/**
 * Rekordbox-RGB colour for a slice: low → red, mid → green, high → blue. Normalized so the
 * dominant band hits full channel, then an HSV-style saturation boost pulls the weaker
 * channels down toward 0 — this makes two-band blends read as vivid neon (orange, cyan,
 * magenta, yellow) like a real Rekordbox/CDJ waveform instead of washed pastels, while a
 * genuinely broadband slice (all three ≈ equal) still renders bright white. (Naive additive
 * blending greys out for broadband material, which is why we normalize + saturate instead.)
 */
const SATURATION = 1.5; // >1 = more vivid; the brightest channel and pure white are preserved
export const bandColor = (
  low: number,
  mid: number,
  high: number,
): { r: number; g: number; b: number } => {
  const inv = 1 / Math.max(low, mid, high, 1e-6);
  // Ratios in 0..1, dominant band = 1. `1 - (1 - c) * S` keeps the max channel (and white)
  // fixed and pushes the others toward 0, raising saturation. Clamp to [0,1].
  const sat = (c: number): number => {
    const ratio = c * inv; // 0..1, dominant band = 1
    const boosted = (1 - ratio) * SATURATION;
    return Math.max(0, Math.min(1, 1 - boosted));
  };
  return {
    r: Math.round(255 * sat(low)),
    g: Math.round(255 * sat(mid)),
    b: Math.round(255 * sat(high)),
  };
};

// ─── progressive "run" bookkeeping (pure; unit-tested) ─────────────────────────
//
// A run is a contiguous stretch of audio the player appended. A run that reaches the byte cap
// is sealed and a continuation run takes over, so memory stays bounded without ever dropping
// audio. These helpers decide how to route an append, which run to decode next, where a
// continuation starts on the timeline, and when a sealed run's chunks may be freed.

/** The fields of a captured run the helpers below need. */
export interface RunLike {
  /** Resolved timeline start in seconds, set at the first successful decode. */
  start?: number;
  /** Bytes captured so far (the init segment included). */
  bytes: number;
  /** `bytes` as of the start of the most recent decode attempt. */
  lastDecodedBytes: number;
  /** Captured chunks; empty once they have been freed. */
  chunks: readonly unknown[];
  /** The run this one continues after that one hit the byte cap. */
  follows?: RunLike;
  /** Duration the last successful decode produced, and how many bytes it covered. */
  decodedSec?: number;
  decodedBytes?: number;
  /** The last decode of this run threw. */
  failed?: boolean;
  /**
   * Decode-attempt id currently in flight for this run (undefined when none). While set,
   * the run's outcome is unknown: dependents wait instead of treating an earlier failure
   * as terminal. Cleared when that attempt settles (success, failure, or expiry).
   */
  decoding?: number;
}

/** True once every captured byte has been decoded, so the run's start and length are final. */
export const isFullyDecoded = (run: RunLike): boolean =>
  run.start !== undefined &&
  run.decodedSec !== undefined &&
  run.decodedBytes === run.bytes;

export type AppendAction = 'drop' | 'append' | 'rollover';

/**
 * Route one appended chunk. A repeated init segment is dropped (decodeAudioData stops at a
 * second init). Otherwise the chunk joins the current run, or — once that run has reached
 * `maxRunBytes` — starts a continuation run.
 */
export const planAppend = (
  run: { bytes: number; leadsWithInit: boolean },
  incomingIsInit: boolean,
  maxRunBytes: number,
): AppendAction => {
  if (incomingIsInit && run.leadsWithInit) return 'drop';
  return run.bytes >= maxRunBytes ? 'rollover' : 'append';
};

export type FollowState = 'ready' | 'wait' | 'drop';

/** True while a run still has captured bytes that no decode has been attempted on. */
const hasUndecodedBytes = (run: RunLike): boolean =>
  run.chunks.length > 0 && run.lastDecodedBytes < run.bytes;

/**
 * Whether a run can be placed on the timeline yet. A continuation starts where its predecessor
 * ends, so it waits until the predecessor is completely decoded.
 *
 * A retry still in flight keeps dependents waiting: its outcome is unknown, so neither the
 * earlier failure nor the missing bytes decide anything yet. It is dropped only for a
 * *terminal* failure: some earlier run in its chain failed to decode and has nothing left
 * to retry (its start can then never be known). A failed run that gained more bytes since
 * the failed attempt is still eligible for another decode, so its continuations keep
 * waiting instead of being released before that retry can succeed. The whole chain is
 * checked so one pass releases every dependent run. A run that continues nothing is ready.
 */
export const followState = (run: RunLike): FollowState => {
  for (let earlier = run.follows; earlier; earlier = earlier.follows) {
    if (earlier.decoding !== undefined) return 'wait';
    if (earlier.failed && !hasUndecodedBytes(earlier)) return 'drop';
  }
  const prev = run.follows;
  if (!prev) return 'ready';
  return isFullyDecoded(prev) ? 'ready' : 'wait';
};

/** Timeline start (seconds) of a run that continues `prev`, which must be fully decoded. */
export const continuationStart = (prev: RunLike): number =>
  (prev.start ?? 0) + (prev.decodedSec ?? 0);

/**
 * Whether a run's chunks can be freed after a decode. Never for the run still being appended
 * to, and for a sealed run only if that decode covered every byte — audio appended while the
 * decode was in flight must still get its own final decode.
 */
export const shouldFreeChunks = (isCurrent: boolean, run: RunLike): boolean =>
  !isCurrent && run.lastDecodedBytes >= run.bytes;

// Large enough that any sealed run outranks any growing one.
const SEALED_PRIORITY = 1e12;

/**
 * Choose the next run to decode, and list runs that can never be placed (their predecessor's
 * decode failed) so the caller can release them. A growing run waits for `minNewBytes` of new
 * data; a sealed run gets no more bytes, so any undecoded tail is decoded straight away and
 * such runs go first (that frees their memory and unblocks their continuations).
 */
export const pickRunToDecode = <R extends RunLike>(
  runs: readonly R[],
  current: R | null,
  opts: { minDecodeBytes: number; minNewBytes: number },
): { pick: { run: R; index: number } | null; dropped: R[] } => {
  const dropped: R[] = [];
  let pick: { run: R; index: number } | null = null;
  let bestScore = -1;
  for (let index = 0; index < runs.length; index++) {
    const run = runs[index];
    if (run.chunks.length === 0) continue; // chunks already freed — nothing to decode
    const state = followState(run);
    if (state === 'drop') {
      dropped.push(run);
      continue;
    }
    if (state === 'wait') continue;
    const sealed = run !== current;
    // A SEALED run can never grow, so batching it would strand its continuation forever.
    // Decode whatever it captured, even below the growing-run threshold.
    if (!sealed && run.bytes < opts.minDecodeBytes) continue;
    const fresh = run.bytes - run.lastDecodedBytes;
    if (fresh < (sealed ? 1 : opts.minNewBytes)) continue;
    const score = (sealed ? SEALED_PRIORITY : 0) + fresh;
    if (score > bestScore) {
      bestScore = score;
      pick = { run, index };
    }
  }
  return { pick, dropped };
};
