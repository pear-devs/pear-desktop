import { createPlugin } from '@/utils';

import { backendStart, backendStop } from './backend';
import {
  analyzeBucket,
  bandColor,
  bucketForProgress,
  bytesEqual,
  endsWithBytes,
  computeFullPeaks,
  continuationStart,
  extractInitSegment,
  followState,
  isFullyDecoded,
  looksLikeInitSegment,
  pickRunToDecode,
  planAppend,
  playedCoverage,
  runBucketRange,
  sampleWindowForBucket,
  shouldAutoFetchFull,
  shouldFreeChunks,
  startsAtFragmentBoundary,
  stripDuplicateInit,
} from './lib';
import style from './style.css?inline';

import type { RendererContext } from '@/types/contexts';
import type { MusicPlayer } from '@/types/music-player';

export type WaveformTheme =
  | 'soundcloud'
  | 'ytmusic'
  | 'traktor'
  | 'mono'
  | 'rekordbox-rgb'
  | 'rekordbox-blue'
  | 'rekordbox-3band'
  | 'traktor-spectrum'
  | 'traktor-ultraviolet'
  | 'traktor-infrared'
  | 'traktor-xray'
  | 'album';

export type WaveformProgressConfig = {
  enabled: boolean;
  theme: WaveformTheme;
  /** Width of each waveform bar, in CSS pixels. */
  barWidth: number;
  /** Gap between bars, in CSS pixels. */
  barGap: number;
  /** Height of the waveform strip, in CSS pixels. */
  height: number;
  /** Vertical scale of the bars (0..~1.2) — leaves headroom below 1. */
  heightScale: number;
  /** Strip background: transparent, or a solid colour sampled from the player bar. */
  background: 'transparent' | 'player';
  /** Bar shape: centred (mirrored) or anchored to the bottom. */
  shape: 'center' | 'bottom';
  /** Render as separated bars, or a continuous 1px-line filled waveform (Rekordbox style). */
  render: 'bars' | 'filled';
  /**
   * Peak sensitivity. Controls how far transient PEAKS (kicks/snares) stick up above the
   * steady RMS body — NOT the overall height (that's `heightScale`/`height`). 0 = flat RMS
   * body (no spikes), 1 = natural true peaks, >1 = exaggerated/punchy. The body height stays
   * put as you change it. Height only — never affects colour or the played-marker position.
   */
  sensitivity: number;
  /**
   * Colour balance for the frequency-coloured modes (Rekordbox RGB, Traktor Spectrum/ramps,
   * 3-Band). 1 = neutral. LOWER it (e.g. 0.7) so loud, bass-heavy sections don't all turn red
   * — it de-emphasises the low band and lifts mid/high, shifting hues toward green/blue; RAISE
   * it for a warmer, redder look. Colour only — never affects height or the marker.
   */
  colorBalance: number;
  /**
   * Normalize the waveform height per track so the loudest section reaches near the full strip
   * height regardless of how loud the track was mastered — quiet material (live recordings)
   * fills the strip instead of looking short. Works in both modes (progressive uses the loudest
   * section decoded so far). Off = fixed gain (true relative loudness; quiet tracks stay short).
   */
  normalizeHeight: boolean;
  /** Height (0..1) for buckets with no data yet, so the strip reads as full. */
  placeholderHeight: number;
  /**
   * Opt-in (off by default — the default is the progressive path, which downloads nothing
   * extra). When on, the whole track is fetched once and every bar is computed from it, so the
   * waveform is complete and never changes: seeking just moves the played marker, it never
   * shifts bars or leaves holes, and forward/backward seeks into un-buffered parts are already
   * drawn. The main-process fetch lives in `backend.ts` (youtubei.js with a PoToken, the same
   * flow as the Downloader plugin, which is NOT required). Tracks longer than `maxFullMinutes`
   * are skipped. Progressive mode builds the strip from what the player buffers instead, but
   * cannot show parts of the track that haven't been buffered yet.
   */
  fullWaveform: boolean;
  /**
   * Only used when `fullWaveform` is OFF. Safety net for the progressive path: if a track
   * plays a few seconds with almost no decoded coverage (resumed mid-track, cached track
   * the capture hooks missed), fetch it once so the strip isn't left grey. Off by default so
   * the default progressive mode never downloads a whole track; opt in separately.
   */
  autoFullFallback: boolean;
  /**
   * Max track length (minutes) to full-fetch. Tracks longer than this skip the whole-track
   * download and use the progressive path instead, so you don't pull a multi-hour live set or
   * DJ mix over the network. 0 = unlimited (always full-fetch regardless of length).
   */
  maxFullMinutes: number;
};

export const defaultConfig: WaveformProgressConfig = {
  enabled: false,
  theme: 'soundcloud',
  barWidth: 2,
  barGap: 1,
  height: 48,
  heightScale: 0.72,
  background: 'transparent',
  shape: 'center',
  render: 'bars',
  sensitivity: 1,
  colorBalance: 1,
  normalizeHeight: true,
  placeholderHeight: 0.12,
  fullWaveform: false, // progressive by default (user preference)
  autoFullFallback: false, // opt-in: the default progressive mode downloads nothing extra
  maxFullMinutes: 30, // skip full-fetch for tracks longer than this (0 = unlimited)
};

// Colour ramp (frequency → colour): stops of [position 0..1, [r,g,b]], dark/low-freq first,
// bright/high-freq last. Drives the Traktor monochrome-style modes.
type Ramp = Array<[number, [number, number, number]]>;

type ThemeDef = {
  label: string;
  /** Menu grouping (sub-folder). */
  group: 'Basic' | 'Rekordbox' | 'Traktor';
  mode: 'solid' | 'rgb' | 'blue' | '3band' | 'album' | 'ramp';
  played: string;
  unplayed: string;
  /** For mode 'ramp': the low-freq → high-freq colour ramp. */
  ramp?: Ramp;
  /**
   * For mode 'rgb': 'traktor' pushes more weight onto the highs and tints mids toward cyan,
   * matching how Traktor's spectrum view differs from Rekordbox's (brighter, cyan vocals).
   */
  spectrumFlavor?: 'traktor';
};

const THEMES: Record<WaveformTheme, ThemeDef> = {
  'soundcloud': {
    label: 'SoundCloud',
    group: 'Basic',
    mode: 'solid',
    played: '#ff5500',
    unplayed: 'rgba(255,255,255,0.25)',
  },
  'ytmusic': {
    label: 'YouTube Music',
    group: 'Basic',
    mode: 'solid',
    played: '#ff0033',
    unplayed: 'rgba(255,255,255,0.22)',
  },
  'mono': {
    label: 'Monochrome',
    group: 'Basic',
    mode: 'solid',
    played: '#ffffff',
    unplayed: 'rgba(255,255,255,0.30)',
  },
  'album': {
    label: 'Album accent',
    group: 'Basic',
    mode: 'album',
    played: '#ff5500',
    unplayed: 'rgba(255,255,255,0.25)',
  },
  'rekordbox-rgb': {
    label: 'RGB',
    group: 'Rekordbox',
    mode: 'rgb',
    played: '#ffffff',
    unplayed: 'rgba(255,255,255,0.25)',
  },
  'rekordbox-3band': {
    label: '3-Band',
    group: 'Rekordbox',
    mode: '3band',
    played: '#ffffff',
    unplayed: 'rgba(255,255,255,0.22)',
  },
  'rekordbox-blue': {
    label: 'Blue',
    group: 'Rekordbox',
    mode: 'blue',
    played: '#0a84ff',
    unplayed: 'rgba(120,170,255,0.25)',
  },
  'traktor-spectrum': {
    label: 'Spectrum (RGB)',
    group: 'Traktor',
    mode: 'rgb',
    spectrumFlavor: 'traktor',
    played: '#ffffff',
    unplayed: 'rgba(255,255,255,0.25)',
  },
  'traktor-infrared': {
    label: 'Infrared',
    group: 'Traktor',
    mode: 'ramp',
    played: '#ffb020',
    unplayed: 'rgba(255,255,255,0.22)',
    // thermal: deep red (bass) → orange → yellow/white (highs)
    ramp: [
      [0, [70, 0, 0]],
      [0.35, [180, 18, 0]],
      [0.62, [255, 92, 0]],
      [0.82, [255, 188, 30]],
      [1, [255, 252, 210]],
    ],
  },
  'traktor-ultraviolet': {
    label: 'Ultraviolet',
    group: 'Traktor',
    mode: 'ramp',
    played: '#b84cff',
    unplayed: 'rgba(200,170,255,0.22)',
    // deep indigo (bass) → violet → magenta/white (highs)
    ramp: [
      [0, [28, 0, 60]],
      [0.4, [92, 0, 165]],
      [0.7, [180, 44, 232]],
      [0.9, [240, 120, 255]],
      [1, [250, 220, 255]],
    ],
  },
  'traktor-xray': {
    label: 'X-Ray',
    group: 'Traktor',
    mode: 'ramp',
    played: '#9fd0ff',
    unplayed: 'rgba(200,220,255,0.22)',
    // near-black navy (bass) → steel blue → white (highs)
    ramp: [
      [0, [6, 12, 34]],
      [0.4, [30, 72, 142]],
      [0.72, [96, 166, 224]],
      [1, [242, 250, 255]],
    ],
  },
  'traktor': {
    label: 'Blue (solid)',
    group: 'Traktor',
    mode: 'solid',
    played: '#00c8ff',
    unplayed: 'rgba(255,255,255,0.22)',
  },
};

// Menu grouping order for the theme sub-folders.
const THEME_GROUPS: Array<ThemeDef['group']> = [
  'Basic',
  'Rekordbox',
  'Traktor',
];

// The render each theme is meant for: the CDJ-style families (Rekordbox, Traktor) are dense,
// continuous waveforms; the Basic family reads as separated bars. Applied automatically when a
// theme is picked, but the user can still override Render manually afterward.
const preferredRender = (key: WaveformTheme): 'bars' | 'filled' =>
  THEMES[key].group === 'Basic' ? 'bars' : 'filled';

// Linear interpolation across a frequency→colour ramp (Traktor monochrome modes).
const rampColor = (ramp: Ramp, pos: number): [number, number, number] => {
  const p = Math.max(0, Math.min(1, pos));
  for (let i = 1; i < ramp.length; i++) {
    const [p1, c1] = ramp[i];
    if (p <= p1) {
      const [p0, c0] = ramp[i - 1];
      const t = p1 === p0 ? 0 : (p - p0) / (p1 - p0);
      const lerp = (a: number, b: number): number => {
        const step = (b - a) * t;
        return Math.round(a + step);
      };
      return [lerp(c0[0], c1[0]), lerp(c0[1], c1[1]), lerp(c0[2], c1[2])];
    }
  }
  return ramp[ramp.length - 1][1];
};

const RES = 2000; // timeline resolution (peaks are indexed by absolute track time)
const DECODE_GAIN = 2.8;
// Amplitude multiplier for decoded peaks. Fixed (DECODE_GAIN) for BOTH the progressive and
// full-waveform paths so a bucket drawn progressively keeps the exact same height when the
// full track swaps in — switching scales mid-track would reflow every bar. Per-band colour
// balance uses fixed per-band gains (see G_LOW/G_MID/G_HIGH), independent of bar height.
let peakScale = DECODE_GAIN;

// Fixed gain for the TRUE-PEAK height source. Peaks are larger than RMS (crest factor), so
// this is well below DECODE_GAIN. Fixed (not per-track) for the same no-reflow reason: the
// progressive and full paths both store 0..1 true peaks, so a single constant keeps heights
// identical across the swap. User `sensitivity` multiplies this; soft-clip tames the top.
const PEAK_GAIN = 1.25;
// Loudest RMS *body* seen so far (running max over every decoded bucket — progressive, live and
// full). Drives the optional per-track height normalization. We normalize by the BODY, not the
// peak: a single transient (clap/kick) pins a peak at full-scale even on a perceptually quiet
// track, so peak-normalizing does nothing there — body (RMS) tracks loudness as heard, so quiet
// masters actually fill the strip. Transients still ride above the body up to the soft-clip
// ceiling. Running (not full-decode-only) so normalization already works during the progressive
// wait before the full download lands; it settles to the true max once the whole track decodes.
let normRefBody = 0;
const BODY_TARGET = 0.72; // loudest body section reaches ~72% of the half-strip; peaks go above

// ---- singleton renderer state ----
let config: WaveformProgressConfig = defaultConfig;
let audioContext: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
// The player's source node our analyser is tapped into (for disconnect on stop).
let audioSourceNode: MediaElementAudioSourceNode | null = null;
let timeData: Uint8Array<ArrayBuffer> | null = null;
let liveFloat: Float32Array | null = null; // reused scratch for time-domain samples
let lastLiveBucket = -1; // last timeline bucket the playhead live-filled (for gap fill)
let video: HTMLVideoElement | null = null;
let playerApi: MusicPlayer | null = null; // for the REAL track duration (see trackDuration)
let playerBar: HTMLElement | null = null;
let canvas: HTMLCanvasElement | null = null;
let ctx2d: CanvasRenderingContext2D | null = null;
let backingW = 0;
let backingH = 0;
let rafId: number | null = null;
let audioCanPlayListener: ((e: Event) => void) | null = null;
let seekingListener: (() => void) | null = null;

// Timeline data, indexed by absolute track position (0..RES-1).
const peaksArr = new Float32Array(RES); // RMS per bucket (kept for reference/debug)
const peaksMaxArr = new Float32Array(RES); // TRUE PEAK per bucket — the drawn-height source
const bandsArr = new Float32Array(RES * 3); // low, mid, high energy per bucket
const filledMask = new Uint8Array(RES); // 1 where DEFINITIVE decoded data exists (never rewritten)
const liveMask = new Uint8Array(RES); // 1 where provisional data exists (a live estimate or a
// partially-covered decode) — drawn like data, but a later decode may still replace it
/** A bucket with anything to draw: definitive decoded data or a provisional sample. */
const hasData = (b: number): boolean => filledMask[b] === 1 || liveMask[b] === 1;
// Monotonic revision of the timeline data, bumped on every write — including a decode that
// replaces a provisional bucket (whose filled/live counts don't change). Lets the paused
// repaint-skip notice data changes that don't change bucket coverage.
let waveformRev = 0;
// Tolerance when deciding whether a run's audio fully covers a bucket (float noise only;
// a real partial overlap is orders of magnitude larger).
const BUCKET_COVER_EPS = 1e-3;

// Fixed per-band gains. Rekordbox lifts the quieter mid/high bands so they read as orange
// and a white core instead of being swamped by the far-louder bass. These are CONSTANTS
// (not derived from the track) on purpose: a running/track-adaptive normalization would be
// calibrated from only the first seconds at track start and then visibly shift the colour
// once the whole track loads. Fixed gains keep the colour identical from the first frame.
// Balanced so a bass-dominant slice actually reads RED (Rekordbox shows low as red/dark
// orange). The old mid/high gains (2.2 / 3.4) over-boosted the mid band — which also carries
// the bass's own harmonics — so it out-weighed the low even in bass sections and the colour
// never reached red (stuck orange/green). Low is lifted and mid/high trimmed: bass → red,
// vocals/synths → green, hats/air → blue, each still winning where it genuinely dominates.
const G_LOW = 1.4;
const G_MID = 1.6;
const G_HIGH = 2.4;

// Envelope smoothing. A single bucket is ~0.1s of RMS, and neighbouring buckets jump
// around, which draws as thin spikes. Rekordbox smooths the envelope between columns so it
// reads as one continuous shape. We average over ±SMOOTH_R filled buckets (a short moving
// average) at draw time — the stored per-bucket data is untouched, only the drawn height is
// softened. Only filled neighbours count, so edges next to undecoded regions don't sag.
const SMOOTH_R = 3;
// Smoothed value of a per-bucket array over ±radius FILLED buckets (edges next to undecoded
// regions don't sag). A SMALL radius (continuous/Rekordbox) keeps the dense per-column detail —
// kicks spike, giving the striated RB texture; a larger one (bars) reads as one shape.
const smoothArr = (arr: Float32Array, b: number, radius: number): number => {
  let sum = 0;
  let n = 0;
  for (let k = -radius; k <= radius; k++) {
    const j = b + k;
    if (j < 0 || j >= RES || !hasData(j)) continue;
    sum += arr[j];
    n++;
  }
  return n ? sum / n : arr[b];
};
// Soft ceiling: below the knee the height is untouched; above it, peaks compress toward 1 with
// a little slope left instead of a hard flat clip — so loud, compressed tracks don't read as a
// flat band glued to the top. Pure fn of the input, so the progressive and full paths scale
// identically (no height jump when the full decode swaps in).
const KNEE = 0.85;
const softClip = (v: number): number => {
  if (v <= KNEE) return Math.max(0, v);
  const span = 1 - KNEE;
  const compressed = span * Math.tanh((v - KNEE) / span);
  return KNEE + compressed;
};
// Drawn amplitude (0..1). The RMS gives a stable BODY height; the true peak sticks up above it
// on transients (kicks). `sensitivity` scales ONLY that peak-above-body excess — so the overall
// waveform size stays put and the knob just makes the peaks protrude more or less (0 = flat RMS
// body, 1 = full natural peaks, >1 = exaggerated). Fixed gain + soft-clip, so no path jump.
const ampFor = (b: number, radius: number): number => {
  const body = smoothArr(peaksArr, b, radius); // RMS envelope
  const peak = smoothArr(peaksMaxArr, b, radius); // true-peak envelope
  const excess = Math.max(0, peak - body);
  // Normalize to fill the strip (loudest body → BODY_TARGET) when enabled and the whole track
  // is decoded; otherwise fixed gain (true relative loudness). Pure fn of state → no path jump
  // beyond the running max growing as louder sections decode.
  const norm =
    (config.normalizeHeight ?? true) && normRefBody > 0
      ? Math.max(0.3, Math.min(8, BODY_TARGET / normRefBody))
      : PEAK_GAIN;
  const lifted = excess * (config.sensitivity ?? 1);
  return softClip((body + lifted) * norm);
};
// Reused scratch so smoothing the three bands allocates nothing per column.
const smBand = new Float32Array(3);
const smoothBands = (b: number): Float32Array => {
  let l = 0;
  let m = 0;
  let h = 0;
  let n = 0;
  for (let k = -SMOOTH_R; k <= SMOOTH_R; k++) {
    const j = b + k;
    if (j < 0 || j >= RES || !hasData(j)) continue;
    const ji = j * 3;
    l += bandsArr[ji];
    m += bandsArr[ji + 1];
    h += bandsArr[ji + 2];
    n++;
  }
  if (n) {
    smBand[0] = l / n;
    smBand[1] = m / n;
    smBand[2] = h / n;
  } else {
    const bi = b * 3;
    smBand[0] = bandsArr[bi];
    smBand[1] = bandsArr[bi + 1];
    smBand[2] = bandsArr[bi + 2];
  }
  return smBand;
};

// Buffered-audio capture, grouped into contiguous "runs". A run starts at each init
// segment (new track or a post-seek fetch) and its timeline start comes from where
// the player buffered it — so seeked regions land in the right place.
type Run = {
  seekTarget: number; // approximate start time (seek target, or 0 for the first run)
  start?: number; // resolved timeline start, computed once and cached (never re-derived)
  chunks: Uint8Array[];
  bytes: number;
  lastDecodedBytes: number;
  /** True once this run contains anything beyond the initialization segment (real media). */
  hasMedia?: boolean;
  /** Buffered-range snapshot taken when the run was created (capture-time evidence).
   *  Preferred over live ranges at decode time, which may already have merged. */
  evidence?: Array<[number, number]> | null;
  /** True once this run holds a complete init segment — tracked separately from
   *  `chunks[0]`, whose look-ahead can be too short to classify (a 4-byte first append). */
  hasInit?: boolean;
  /** Set when this run continues one that hit MAX_RUN_BYTES: it starts where that one ends. */
  follows?: Run;
  /** Byte cap reached: cut at the next fragment boundary instead of mid-fragment. */
  rolloverArmed?: boolean;
  /** The start time is an estimate (merged-range snap), not a measured media position:
   *  its buckets stay provisional so a later, better-placed decode can still correct them. */
  startEstimated?: boolean;
  /** Duration of the audio the last successful decode produced, and the bytes it covered. */
  decodedSec?: number;
  decodedBytes?: number;
  failed?: boolean; // decoding this run threw; nothing further can be placed from it
  /** Decode-attempt id currently in flight (see followState) — undefined when settled. */
  decoding?: number;
};
let mseHooked = false;
// The appendBuffer/addSourceBuffer wrappers are installed once and can't be cleanly removed
// (the player or another plugin may have wrapped them since), so they stay in place for the life
// of the page. This flag makes them inert — no copying, no memory retained — whenever the
// plugin is stopped.
let captureActive = false;
const audioSourceBuffers = new WeakSet<SourceBuffer>();
// Accepted-but-unconfirmed appends, per SourceBuffer: MSE can report a parser error
// ASYNCHRONOUSLY (`error`/`abort` events) after appendBuffer() already returned, so bytes
// are only RECORDED once the originating buffer fires `update`. Each entry carries the
// track key at capture time (stale-track bytes are dropped) and the run that was current
// at submit time (so a seek between submit and confirm can't divert pre-seek audio into
// the post-seek run). (Weak keys: a removed buffer takes its queue with it.)
interface PendingAppend {
  u8: Uint8Array;
  key: string;
  run: Run | null;
  // Playback position at submit time: if no run existed then, the fresh run is seeded
  // with the position the audio was appended at — not wherever the playhead moved by
  // confirmation time.
  seekTarget: number;
  // Track generation at submit time: an append confirmed after A → B → A carries A's key
  // again, but its bytes belong to the old visit and must not prime the new track state.
  gen: number;
}
/** Marker entries (remove() completions, or appends with nothing to record): their
 *  `update` event must not consume another append's confirmation. */
type PendingEntry = PendingAppend | { removal: true } | { skipped: true };
const pendingAppends = new WeakMap<SourceBuffer, Array<PendingEntry>>();
// In-flight appends per run: a sealed run must not release its chunks while one of its
// appends is still unconfirmed — the bytes would be freed before any decode saw them.
const pendingByRun = new WeakMap<Run, number>();
const releasePending = (entry: PendingEntry) => {
  if (!('u8' in entry) || !entry.run) return;
  const left = Math.max(0, (pendingByRun.get(entry.run) ?? 1) - 1);
  pendingByRun.set(entry.run, left);
  // A sealed, fully-decoded run whose last in-flight append just settled no longer needs
  // its chunks — free them now instead of holding a full cap-sized buffer until eviction.
  // (Timing metadata stays on the object for continuations.)
  if (left === 0 && entry.run !== currentRun && isFullyDecoded(entry.run)) {
    entry.run.chunks = [];
  }
};
// Wire confirmation events for an audio buffer: success records, failure drops.
// `update` (not `updateend`) is the success signal — `updateend` also fires after a
// failed append, while `error`/`abort` drop that append's bytes.
const hookAppendEvents = (sb: SourceBuffer) => {
  sb.addEventListener('update', () => {
    const next = pendingAppends.get(sb)?.shift();
    if (!next) return;
    try {
      // Marker entries (remove() completions, appends with nothing to record) only
      // advance the queue — they never commit bytes.
      if (!('u8' in next)) return;
      if (!captureActive) return;
      commitToRun(next);
    } catch {
      /* never let capture break playback */
    } finally {
      releasePending(next);
    }
  });
  const dropPending = () => {
    const next = pendingAppends.get(sb)?.shift();
    if (next) releasePending(next);
  };
  sb.addEventListener('error', dropPending);
  sb.addEventListener('abort', dropPending);
};
let runs: Run[] = [];
let currentRun: Run | null = null;
let pendingSeekTime = 0;
/** The very first appended chunk of a track — the init segment, used to seed seek-runs. */
let initSegment: Uint8Array | null = null;
/** Bytes accumulated while waiting for a complete init segment (see extractInitSegment). */
let initAccum: Uint8Array = new Uint8Array(0);
/** Give up parsing the init after this much accumulation — keep the first chunk instead. */
const INIT_ACCUM_MAX = 2 * 1024 * 1024;
/** Concatenate two chunks (Uint8Array has no concat). */
const concatU8 = (a: Uint8Array, b: Uint8Array): Uint8Array => {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
};
let decoding = false;
let decodingStartedAt = 0; // guards against a decodeAudioData that never settles
// Identity of the decode in flight. The watchdog below can expire a decode that is merely slow
// and start another; the expired one must then be unable to touch run metadata, free chunks, or
// clear the newer decode's `decoding` flag when it finally settles.
let decodeAttempt = 0;
// How many extra windows the watchdog has granted the in-flight decode without new data
// (a slow but valid decode). Bounded: a decode that never settles still gets expired.
let slowDecodeWaits = 0;
const MAX_SLOW_DECODE_WAITS = 2;
// Hard cap on how many times the SAME byte-snapshot may be re-submitted after the watchdog
// expires it (decodeAudioData cannot be cancelled). Past this the run is marked failed so
// the selector moves on and native decode work stops piling up.
let stalledRun: Run | null = null;
let stalledBytes = -1;
let stalledTries = 0;
const MAX_STALLED_TRIES = 2;
let decodeRun: Run | null = null; // the run the in-flight decode is working on
let trackKey = '';
// Accumulated PLAYING time on the current track (excludes paused/buffering spans): the
// auto-fallback trigger measures the chance the progressive path actually had, not
// wall-clock time since the track appeared (a paused cached track must not auto-fetch).
let playingMs = 0;
let lastPlayTick = 0;
let lastPlayPos = -1;

// Full-waveform (opt-in) state.
let ipcRenderer: RendererContext<WaveformProgressConfig>['ipc'] | null = null;
let fullDecoded = false; // true once the whole track's peaks are in place
let fullFetchKey = ''; // track we've already fetched/attempted (avoids re-fetching)
// Generation at the last attempt: an attempt from an earlier visit must not suppress a
// retry after returning (the key alone can't tell visits apart).
let fullFetchGen = -1;
let fullFetching = false;
// Ownership token for the in-flight full fetch: only the attempt that set the flag may
// clear it. Without this, a fetch that settles after a disable/re-enable cycle clears
// the new activation's flag, letting a third track start while the second is active.
let fullFetchSeq = 0;

const MIN_DECODE_BYTES = 60 * 1024;
const MIN_NEW_BYTES = 120 * 1024;
const MAX_RUNS = 24;
// Per-run cap. Audio-only is ~16KB/s, so 6MB ≈ 6 min — far more than the look-ahead needs,
// and it bounds memory. (Was 32MB ≈ 33 min, which bloated the heap over long sessions.)
const MAX_RUN_BYTES = 6 * 1024 * 1024;
// Extra headroom while waiting for a fragment boundary after the cap is hit: the run keeps
// buffering past MAX_RUN_BYTES until the next append starts on a boundary, but never past
// this, so a stream of boundary-less appends can't grow it without limit.
const ROLLOVER_OVERCAP_BYTES = 2 * 1024 * 1024;

// album-accent cache
let albumColor = '#ff5500';
let albumColorSrc: string | null = null;
let albumColorLoading: string | null = null; // src currently being sampled (de-dupes probes)

// ─── debug logging ───────────────────────────────────────────────────────────
// OFF by default. Turn on at runtime with `window.__waveformLog = true` to diagnose;
// every line is prefixed with [WF] for easy filtering.
const WF_BUILD = '2026-11-20a';
const wfLogOn = (): boolean =>
  (window as unknown as { __waveformLog?: boolean }).__waveformLog === true;
const wfLog = (...args: unknown[]) => {
  if (wfLogOn()) console.info('[WF]', ...args);
};
/** Compact snapshot of the current filled timeline: total %, and filled bucket spans. */
const filledSpans = (): { pct: string; filled: number; spans: string } => {
  let filled = 0;
  const spans: string[] = [];
  let runStart = -1;
  for (let i = 0; i <= RES; i++) {
    const on = i < RES && hasData(i);
    if (on) filled++;
    if (on && runStart < 0) runStart = i;
    else if (!on && runStart >= 0) {
      spans.push(`${runStart}-${i - 1}`);
      runStart = -1;
    }
  }
  return {
    pct: Math.round((filled / RES) * 100) + '%',
    filled,
    spans: spans.join(',') || '(none)',
  };
};
/** The video element's buffered TimeRanges, as [start,end] pairs in seconds. */
const bufferedRanges = (v: HTMLVideoElement): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  try {
    for (let i = 0; i < v.buffered.length; i++) {
      out.push([
        Math.round(v.buffered.start(i) * 10) / 10,
        Math.round(v.buffered.end(i) * 10) / 10,
      ]);
    }
  } catch {
    /* buffered can throw if not ready */
  }
  return out;
};
let lastStateLog = 0; // throttle the periodic state snapshot
let lastAriaSec = -1; // throttle the slider's aria-value updates to whole seconds
let lastAriaDur = -1; // last duration written to aria-valuemax (refresh when it changes)
/** Seconds → "M:SS" for the slider's accessible value text. */
const formatTime = (s: number): string => {
  const total = Math.max(0, Math.floor(s));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${sec < 10 ? '0' : ''}${sec}`;
};
// Bumped on every track change. An in-flight async decode captures the value before awaiting
// and discards its result if the track changed meanwhile — otherwise the previous track's
// audio could be written into the new track's (freshly reset) timeline.
let trackGen = 0;

const resetForNewTrack = () => {
  trackGen++;
  peaksArr.fill(0);
  peaksMaxArr.fill(0);
  bandsArr.fill(0);
  filledMask.fill(0);
  liveMask.fill(0);
  normRefBody = 0;
  runs = [];
  currentRun = null;
  initSegment = null;
  initAccum = new Uint8Array(0);
  pendingSeekTime = 0;
  lastLiveBucket = -1;
  slowDecodeWaits = 0;
  stalledRun = null;
  stalledBytes = -1;
  stalledTries = 0;
  playingMs = 0;
  lastPlayTick = 0;
  lastPlayPos = -1;
  fullDecoded = false;
  peakScale = DECODE_GAIN;
  wfLog('RESET for new track', { videoId: currentVideoId(), build: WF_BUILD });
};

/**
 * Reset the timeline + capture state if (and only if) the track really changed. Called from
 * the append hook (before a new track's bytes are recorded) and from draw() as a backstop.
 */
const syncTrack = () => {
  const key = currentTrackKey();
  if (key && key !== trackKey) {
    trackKey = key;
    resetForNewTrack();
  }
};

/**
 * Song identity, so we reset only on a real track change. The authoritative videoId from
 * the player API (see currentVideoId). Empty string when it's momentarily unavailable
 * (during a transition) — draw()'s `key && key !== trackKey` guard treats '' as "don't
 * reset", so a transient blip never wipes the waveform.
 */
const currentTrackKey = (): string => currentVideoId() ?? '';

/** Start a run that continues `prev` after it hit the byte cap, seeded with the init segment. */
const rollOverRun = (prev: Run): Run => {
  const next: Run = {
    seekTarget: prev.seekTarget,
    chunks: initSegment ? [initSegment] : [],
    bytes: initSegment?.length ?? 0,
    hasInit: !!initSegment,
    lastDecodedBytes: 0,
    follows: prev,
  };
  // A run that finished decoding while it was still the current one kept its chunks (it could
  // still have grown). Now that it is sealed nothing more will be appended, so release them and
  // keep only its timing metadata, which is all its continuation needs. If it still has bytes
  // to decode, the chunks stay until that final decode has run — and never while one of its
  // appends is still unconfirmed (see pendingByRun).
  if (isFullyDecoded(prev) && (pendingByRun.get(prev) ?? 0) === 0) prev.chunks = [];
  currentRun = next;
  runs.push(next);
  if (runs.length > MAX_RUNS) evictOldestRun();
  return currentRun;
};

/** True while every link of the run's follows-chain can still be resolved: fully decoded
 *  links carry their timing on the object itself (so evicting them from `runs` is harmless),
 *  anything else must still be present in `runs`. */
const chainIntact = (run: Run): boolean => {
  for (let prev = run.follows; prev; prev = prev.follows) {
    if (isFullyDecoded(prev)) continue;
    if (!runs.includes(prev)) return false;
  }
  return true;
};

/** Discard an unplaceable current run and restart capture fresh at the playhead. Used when
 *  the run's predecessor can never resolve its start (terminal decode failure, or evicted
 *  from `runs` before decoding): later appends would otherwise pile into a run the
 *  selector discards forever, and progressive capture could never recover on uninterrupted
 *  playback. A predecessor that merely failed but still has bytes to decode is left alone —
 *  its retry may yet succeed (see followState). */
const retireCurrentRun = (why: string) => {
  if (currentRun) {
    currentRun.failed = true;
    currentRun.chunks = [];
    currentRun.decoding = undefined;
  }
  const dur = trackDuration();
  const now = playbackPosition();
  pendingSeekTime =
    isFinite(dur) && dur > 0 ? Math.min(Math.max(now, 0), dur) : now;
  currentRun = {
    seekTarget: pendingSeekTime,
    chunks: initSegment ? [initSegment] : [],
    bytes: initSegment?.length ?? 0,
    hasInit: !!initSegment,
    lastDecodedBytes: 0,
    evidence: snapshotBufferedRanges(),
  };
  runs.push(currentRun);
  wfLog('retire current run', { why });
  if (runs.length > MAX_RUNS) evictOldestRun();
};

/** Drop the oldest run, keeping dependency groups usable. A sealed run that depended on an
 *  evicted, never-decoded predecessor can never be placed (its start is unknowable), so
 *  fail it and release its chunks instead of letting it wait forever; if that leaves the
 *  growing run without a resolvable start, restart capture. Evicting a fully-decoded
 *  predecessor is harmless — its timing metadata stays on the object for its continuations. */
const evictOldestRun = () => {
  runs.shift();
  for (const run of runs) {
    if (run !== currentRun && !chainIntact(run)) {
      run.failed = true;
      run.chunks = [];
    }
  }
  if (currentRun && !chainIntact(currentRun))
    retireCurrentRun('predecessor-evicted');
};

/** Cache the track's init segment from one chunk (submit-ordered; see commitToRun). */
const ensureInitCached = (u8: Uint8Array) => {
  // Cache only a COMPLETE init segment (ftyp + moov): the first append can also carry
  // the first media fragment (which must not be prepended to later runs), and the init
  // can span several appends (a partial header seeds runs that can never decode).
  // Accumulate across appends until moov is whole; give up and keep the first chunk if
  // the stream never shows one (previous behaviour).
  initAccum = concatU8(initAccum, u8);
  if (initAccum.length > INIT_ACCUM_MAX) {
    // Over the accumulation cap (e.g. a 3 MiB first append): try extraction on a bounded
    // prefix before falling back — a complete init at its start must be cached alone, not
    // together with megabytes of media that would then be prepended to every later run.
    const carved = extractInitSegment(initAccum.subarray(0, INIT_ACCUM_MAX));
    // Accept only a verified init strictly inside the cap (a complete ftyp+moov is
    // kilobytes): the whole-input fallback means "unrecognised", not "complete".
    if (carved.complete && carved.init.length < INIT_ACCUM_MAX) {
      initSegment = carved.init;
    } else {
      initSegment = u8; // give up parsing — keep the first chunk (previous behaviour)
    }
    initAccum = new Uint8Array(0);
  } else {
    const carved = extractInitSegment(initAccum);
    if (carved.complete) {
      initSegment = carved.init;
      initAccum = new Uint8Array(0);
    }
  }
};

type CommitTarget = { run: Run; chunk: Uint8Array } | null;
/**
 * Route one CONFIRMED chunk into its run: strip a verified duplicate init prefix, start a
 * fresh run on a complete REPLACEMENT init (e.g. quality change) keeping its media suffix,
 * and apply the byte-cap rollover to the growing run. Returns null when the chunk is
 * dropped (pure duplicate or undecodable header).
 */
const routeChunk = (run: Run, u8: Uint8Array): CommitTarget => {
  // A run whose init arrived over several appends (e.g. a 4-byte first fragment) still
  // holds the assembled init even though `chunks[0]` is too short to classify — use the
  // explicit flag as well, so a later complete init is recognised as a duplicate.
  const runLeadsWithInit =
    !!run.hasInit ||
    (run.chunks.length > 0 && looksLikeInitSegment(run.chunks[0]));
  if (runLeadsWithInit && looksLikeInitSegment(u8)) {
    if (initSegment) {
      // Same length or longer: a byte-identical prefix is a verified duplicate — keep
      // only the media suffix (empty suffix = exact duplicate → drop below).
      const rest = u8.length >= initSegment.length ? stripDuplicateInit(u8, initSegment) : null;
      if (rest && rest.length > 0) {
        u8 = rest;
      } else if (!rest) {
        // Not a verified duplicate (shorter, or different bytes): independently validate
        // a recognizable replacement init of any size before discarding — MSE associates
        // media with the most recent init, so dropping a real replacement would lose
        // accepted audio. An init identical to the cached one stays a duplicate.
        const carved = extractInitSegment(u8);
        if (carved.complete && !bytesEqual(carved.init, initSegment)) {
          initSegment = carved.init;
          initAccum = new Uint8Array(0);
        const fresh: Run = {
          // A replacement init has no measured media timestamp: the playhead is only a
          // guess, so keep its buckets provisional (a later decode can still correct them).
          seekTarget: playbackPosition(),
          startEstimated: true,
          chunks: [carved.init],
          bytes: carved.init.length,
          hasInit: true,
          lastDecodedBytes: 0,
          evidence: snapshotBufferedRanges(),
        };
          runs.push(fresh);
          if (runs.length > MAX_RUNS) evictOldestRun();
          // Only become the growing run if the submit-time run still owns capture: a seek
          // between submit and confirm must keep its post-seek run current.
          if (run === currentRun) currentRun = fresh;
          if (carved.init.length < u8.length) {
            return { run: fresh, chunk: u8.slice(carved.init.length) };
          }
        }
        return null;
      } else {
        return null; // exact duplicate — drop
      }
    } else {
      return null; // no cached init to verify against — drop
    }
  }
  if (run === currentRun) {
    // Keep the per-run memory bound without ever dropping audio: past the cap, continue in
    // a fresh run whose timeline start is resolved from where this one ends. Otherwise a
    // long track that plays without a seek never gets the audio buffered beyond the cap
    // drawn. The cap only REQUESTS rollover: the cut waits for the next fragment boundary,
    // so the continuation (seeded with just the init) doesn't start mid-mdat with bytes it
    // cannot decode. Past the overcap headroom the cut is forced (previous behaviour).
    // Sealed runs just extend — their continuation already carries future audio.
    const action = planAppend(
      {
        bytes: run.bytes,
        leadsWithInit:
          run.chunks.length > 0 && looksLikeInitSegment(run.chunks[0]),
      },
      looksLikeInitSegment(u8),
      MAX_RUN_BYTES,
    );
    if (action === 'drop') return null;
    // Also roll over when THIS append would push the run past the cap: a small run can
    // otherwise swallow one large chunk and silently exceed the memory bound. A chunk that is
    // itself larger than the cap can't be split safely, so it is accepted on its own. Only
    // roll when the outgoing run actually holds MEDIA — an init-only run is not decodable on
    // its own, so its continuation would wait on a predecessor that can never produce audio.
    const wouldExceed =
      action === 'append' &&
      !!run.hasMedia &&
      run.bytes + u8.length > MAX_RUN_BYTES;
    if (action === 'rollover' || wouldExceed) {
      // Check the boundary even on the first over-cap append: if it already starts a new
      // fragment, cut right away so the continuation keeps its moof — otherwise the
      // fragment header lands in the sealed run and a forced cut later would start the
      // new run mid-fragment. Past the overcap headroom the cut is forced (previous
      // behaviour).
      if (
        startsAtFragmentBoundary(u8) ||
        (run.rolloverArmed && run.bytes >= MAX_RUN_BYTES + ROLLOVER_OVERCAP_BYTES)
      ) {
        currentRun = rollOverRun(run);
        run = currentRun;
      } else if (!run.rolloverArmed) {
        run.rolloverArmed = true;
      } else if (
        run.bytes + u8.length > MAX_RUN_BYTES + ROLLOVER_OVERCAP_BYTES
      ) {
        // Armed, still mid-fragment, and even the overcap headroom can't absorb this chunk:
        // there is no safe split point, so STOP capturing this fragment. Playback is
        // untouched (the native append already happened); capture resumes at the next
        // decodable boundary via a later append.
        return null;
      }
      // else: armed and mid-fragment — keep buffering this run until a boundary arrives.
    }
  }
  return { run, chunk: u8 };
};

/**
 * Commit one player-confirmed chunk to the run that was current at submit time. A seek
 * between submit and confirm must not divert pre-seek bytes into the post-seek run (they
 * would be placed at the seek point instead of their real time), and bytes whose run can
 * never be placed (evicted, terminally failed) are dropped — the live sampler covers them.
 */
const commitToRun = (entry: PendingAppend) => {
  // Switch capture state to the new track BEFORE recording its bytes. Otherwise a new
  // track's init segment appended ahead of the next animation frame is treated as a
  // repeat of the old track's, and the frame-based reset then wipes it — leaving later
  // media-only appends without a header (undecodable).
  syncTrack();
  // Once the full waveform is installed the progressive timeline is complete: stop
  // recording (each rollover would otherwise retain its undecoded predecessor through
  // `follows`, leaking memory for the rest of a long track). A failed fetch leaves
  // fullDecoded false, so progressive capture keeps running.
  if (fullDecoded) return;
  // Bytes submitted before a track change but confirmed after it no longer match the
  // current track — drop them instead of landing in the wrong timeline. (Bytes appended
  // after the change carry the new key, so the new track still records correctly.) A
  // submit from an earlier visit (A → B → A) carries a stale generation even when the
  // key matches again, so it must not prime the new track's init cache or runs.
  if (entry.key !== currentTrackKey() || entry.gen !== trackGen) return;
  if (!initSegment) ensureInitCached(entry.u8);
  // Give the cached init to any run that holds no bytes yet, and only then record that the
  // run has an init. This covers BOTH the growing run and the submit-time run: a seek may
  // have replaced `currentRun` between submit and confirm, leaving the append's own run
  // empty — seeding only `currentRun` would leave that run unable to decode its media.
  // (A run that already holds bytes had the init assembled from them, so the flag is safe:
  // a genuinely different init still takes the replacement path in routeChunk.)
  if (initSegment) {
    let seeded = false;
    const targets = [currentRun, entry.run];
    for (const target of targets) {
      if (!target || target.failed || !runs.includes(target)) continue;
      if (target.chunks.length === 0) {
        target.chunks.push(initSegment);
        target.bytes += initSegment.length;
        seeded = true;
      }
      target.hasInit = true;
    }
    // Drop this append ONLY if we just seeded a run with bytes that this chunk supplied
    // (e.g. the 4-byte ftyp prefix arrived earlier and this chunk carries the rest of moov).
    // When the run already held those bytes, the chunk still has to be appended — dropping it
    // would leave the run with an incomplete init followed by media.
    if (seeded && endsWithBytes(initSegment, entry.u8)) return;
  }
  let run = entry.run;
  if (!run) {
    // No run existed at submit time — create one now, seeded with the cached init like
    // retireCurrentRun and the seek handler do (an unseeded media-only run could never
    // decode). routeChunk drops the incoming chunk if it IS that same init, so seeding
    // here never appends it twice; with no cached init the run starts empty as before.
    if (!currentRun) {
      const seed = initSegment ? [initSegment] : [];
      currentRun = {
        seekTarget: entry.seekTarget,
        chunks: seed,
        bytes: initSegment?.length ?? 0,
        hasInit: !!initSegment,
        lastDecodedBytes: 0,
      };
      runs.push(currentRun);
      if (runs.length > MAX_RUNS) evictOldestRun();
    }
    run = currentRun;
  } else if (!runs.includes(run) || followState(run) === 'drop') {
    return;
  }
  const c = routeChunk(run, entry.u8);
  if (!c) return;
  c.run.chunks.push(c.chunk);
  c.run.bytes += c.chunk.length;
  if (!looksLikeInitSegment(c.chunk)) c.run.hasMedia = true;
  // Its appended audio is now buffered: refresh the placement evidence for a run that
  // hasn't been placed yet, so a seek run isn't located from a PRE-seek range snapshot.
  if (c.run.start === undefined) c.run.evidence = snapshotBufferedRanges();
};

/** Keep copies of the audio the player downloads, grouped into contiguous runs. */
const hookMse = () => {
  if (mseHooked || typeof MediaSource === 'undefined') return;
  mseHooked = true;
  try {
    // oxlint-disable-next-line typescript/unbound-method -- re-bound via .call below
    const origAdd = MediaSource.prototype.addSourceBuffer;
    MediaSource.prototype.addSourceBuffer = function (mime: string) {
      const sb = origAdd.call(this, mime);
      try {
        if (/audio|mp4a|opus|vorbis|aac/i.test(mime)) {
          audioSourceBuffers.add(sb);
          hookAppendEvents(sb);
        }
      } catch {
        /* ignore */
      }
      return sb;
    };

    // oxlint-disable-next-line typescript/unbound-method -- re-bound via .call below
    const origAppend = SourceBuffer.prototype.appendBuffer;
    SourceBuffer.prototype.appendBuffer = function (data: BufferSource) {
      // Copy the bytes before handing them to the player, but only QUEUE them: the native
      // call can still fail asynchronously (the player gets an `error` event after a normal
      // return), and recording rejected bytes would feed the decoder audio the player never
      // played. The queue drains on `update` (success) and drops on `error`/`abort`.
      // If the SourceBuffer is busy the native call throws and the player retries — nothing
      // is queued, so the retried segment isn't captured twice.
      // Once the full waveform is installed, progressive capture is done: skip the copy
      // (each append still queues a lightweight marker so its `update` can't consume
      // another append's confirmation). Capture resumes on the next track's reset.
      // The track is synchronized BEFORE reading fullDecoded: otherwise track B's init,
      // appended while the flag is still true for track A, would be skipped as a marker
      // and later media-only appends could never restore it.
      if (audioSourceBuffers.has(this)) syncTrack();
      let captured: Uint8Array | null = null;
      try {
        if (
          audioSourceBuffers.has(this) &&
          captureActive &&
          !fullDecoded
        ) {
          captured =
            data instanceof ArrayBuffer
              ? new Uint8Array(data.slice(0))
              : new Uint8Array(
                  (data as ArrayBufferView).buffer.slice(
                    (data as ArrayBufferView).byteOffset,
                    (data as ArrayBufferView).byteOffset +
                      (data as ArrayBufferView).byteLength,
                  ),
                );
        }
      } catch {
        captured = null; // never let capture break playback
      }
      const result = origAppend.call(this, data as ArrayBuffer); // a throw reaches the player untouched
      if (!audioSourceBuffers.has(this)) return result;
      const queue = pendingAppends.get(this) ?? [];
      if (captured) {
        // Identity (and a run reservation) at submit time: a seek before `update` must not
        // divert these (pre-seek) bytes into the post-seek run. The run is reserved now —
        // even when none exists yet — so an intervening seek can't change its destination;
        // bytes are only committed on confirmation. (Track identity was already synced
        // above, before the copy decision.) The confirmation-time key check still drops
        // genuinely late appends from the previous track.
        let run = currentRun;
        if (!run) {
        const seed = initSegment ? [initSegment] : [];
        run = {
          seekTarget: pendingSeekTime,
          chunks: seed,
          bytes: initSegment?.length ?? 0,
          hasInit: !!initSegment,
          lastDecodedBytes: 0,
          evidence: snapshotBufferedRanges(),
        };
          runs.push(run);
          if (runs.length > MAX_RUNS) evictOldestRun();
          currentRun = run;
        }
        pendingByRun.set(run, (pendingByRun.get(run) ?? 0) + 1);
        queue.push({
          u8: captured,
          key: currentTrackKey(),
          run,
          seekTarget: pendingSeekTime,
          gen: trackGen,
        });
      } else {
        // No bytes to record (capture off or full waveform installed): still queue a
        // lightweight marker so this append's `update` can't consume another append's
        // confirmation entry. Consumed without committing anything.
        queue.push({ skipped: true });
      }
      pendingAppends.set(this, queue);
      return result;
    };

    // oxlint-disable-next-line typescript/unbound-method -- re-bound via .call below
    const origRemove = SourceBuffer.prototype.remove;
    SourceBuffer.prototype.remove = function (start: number, end: number) {
      const result = origRemove.call(this, start, end);
      // A completed remove() fires `update` too: queue a marker for its event so it
      // doesn't consume a pending append's confirmation (which would record that append
      // AND lose the slot tracking). Only queued after a normal return — a throw while
      // the buffer is updating means no event will fire.
      if (audioSourceBuffers.has(this)) {
        const queue = pendingAppends.get(this) ?? [];
        queue.push({ removal: true });
        pendingAppends.set(this, queue);
      }
      return result;
    };
  } catch {
    /* fall back to the live analyser if patching fails */
  }
};

/** Decode a run's audio and write its peaks into the timeline at the right place.
 *  `definitive` is false when the run's start is only estimated (e.g. snapped to a merged
 *  buffered range): its buckets stay provisional so a later, better-placed decode — or the
 *  live sampler — can still correct them instead of being locked out by write-once. */
const placeRun = (
  audioBuffer: AudioBuffer,
  start: number,
  trackDur: number,
  definitive: boolean,
) => {
  const sr = audioBuffer.sampleRate;
  const len = audioBuffer.length;
  const chans = Math.min(2, audioBuffer.numberOfChannels);
  const channels: Float32Array[] = [];
  for (let c = 0; c < chans; c++) channels.push(audioBuffer.getChannelData(c));

  const { start: b0, end: b1 } = runBucketRange(
    start,
    audioBuffer.duration,
    trackDur,
    RES,
  );
  const runEnd = start + audioBuffer.duration;
  const bucketDur = trackDur / RES;
  let newlyFilled = 0;
  let skipped = 0;
  let wrote = false; // any bucket data changed (definitive or provisional) → repaint
  for (let b = b0; b < b1; b++) {
    // WRITE-ONCE for definitive buckets: never rewrite a bucket that has complete decoded
    // data. This is THE fix for "bars move around" — runs re-decode as they grow and used
    // to recompute the same region every time (slightly different values → shimmer). The
    // first complete value wins and stays put; later decodes only extend into new buckets.
    // Buckets the run covers only PARTIALLY (its first/last bucket when the audio starts or
    // ends mid-bucket) stay provisional instead: values are written so there is something to
    // draw, but the mask is left clear so a later decode covering the whole bucket — or the
    // live sampler — can still complete it. Otherwise a transient in the uncovered remainder
    // would be missed forever.
    if (filledMask[b]) {
      skipped++;
      continue;
    }
    const win = sampleWindowForBucket(b, start, trackDur, RES, sr, len);
    if (!win) continue;
    const a = analyzeBucket(channels, win.start, win.end);
    peaksArr[b] = a.rms;
    if (a.rms > normRefBody) normRefBody = a.rms; // running loudness ref for normalization
    peaksMaxArr[b] = a.peak;
    const bi = b * 3;
    bandsArr[bi] = a.low;
    bandsArr[bi + 1] = a.mid;
    bandsArr[bi + 2] = a.high;
    wrote = true;
    if (
      definitive &&
      b * bucketDur >= start - BUCKET_COVER_EPS &&
      (b + 1) * bucketDur <= runEnd + BUCKET_COVER_EPS
    ) {
      filledMask[b] = 1;
      liveMask[b] = 0;
      newlyFilled++;
    } else {
      liveMask[b] = 1; // provisional — still completable
    }
  }
  if (wrote) waveformRev++; // visible data changed (incl. provisional replacements)
  wfLog('placeRun', {
    startSec: Math.round(start),
    durSec: Math.round(audioBuffer.duration),
    buckets: `${b0}-${b1}`,
    newlyFilled,
    skipped, // already-filled buckets left untouched (was the "overwritten" jitter)
  });
};

// A seek lands mid-segment: the player fetches from the segment boundary just BEFORE the
// target, so the decoded PCM begins slightly earlier than `seekTarget`. Placing it at the
// target would shift the whole run late. The buffered range that contains the target starts
// at that boundary, so use it — but only when it begins within this window before the target.
// A range merged with older audio starts far earlier (it would snap the run to ~0 and corrupt
// the track start), so those are ignored and we fall back to the seek target.
const MAX_SEGMENT_LEAD_SEC = 10;
// Snaps within this window of the range start are trusted as the media start; a snap from
// farther back usually means the range merged with older audio, so the placement stays
// provisional (replaceable) instead of definitive.
const CONFIDENT_LEAD_SEC = 2;

/** Snapshot of video.buffered ranges, or null when unavailable. Captured when a run is
 *  created so placement uses the ranges the player reported for that audio — not whatever
 *  merged ranges exist by the time the decode finishes. */
const snapshotBufferedRanges = (): Array<[number, number]> | null => {
  try {
    if (!video) return null;
    const out: Array<[number, number]> = [];
    for (let i = 0; i < video.buffered.length; i++) {
      out.push([video.buffered.start(i), video.buffered.end(i)]);
    }
    return out;
  } catch {
    return null;
  }
};

/** Timeline start (seconds) for a run created at `seekTarget`, plus whether that start
 *  is confident. `evidence` is the buffered-range snapshot taken when the run's audio was
 *  appended (preferred): live ranges may already have merged with older audio by the time
 *  the decode runs. A merged range can start long before the run's actual first sample;
 *  snapping to such a start must not mark buckets definitive. */
const alignedRunStart = (
  seekTarget: number,
  trackDur: number,
  evidence?: Array<[number, number]> | null,
): { start: number; confident: boolean } => {
  const target = Math.min(Math.max(seekTarget, 0), trackDur);
  if (target === 0) return { start: target, confident: true };
  // Prefer the capture-time ranges; fall back to the live ones only without evidence.
  let list: Array<readonly [number, number]> | null =
    evidence && evidence.length > 0 ? evidence : null;
  if (!list && video) {
    try {
      const live: Array<[number, number]> = [];
      for (let i = 0; i < video.buffered.length; i++) {
        live.push([video.buffered.start(i), video.buffered.end(i)]);
      }
      list = live;
    } catch {
      list = null; // buffered can throw if not ready — fall through to the target
    }
  }
  if (list) {
    for (const [s, e] of list) {
      if (target >= s && target <= e) {
        const lead = target - s;
        if (lead > 0 && lead <= MAX_SEGMENT_LEAD_SEC)
          return { start: s, confident: lead <= CONFIDENT_LEAD_SEC };
        // The range starts far before the target: it has merged with older audio and tells
        // us nothing about where this fragment actually starts. Fall back to the seek
        // target, but keep it PROVISIONAL so a later decode can still correct it.
        return { start: target, confident: false };
      }
    }
    // Capture-time evidence was provided but no range contains the target: placement is
    // a guess, so keep it provisional rather than definitive.
    if (evidence && evidence.length > 0) return { start: target, confident: false };
  }
  return { start: target, confident: true };
};

/** Pick the run with the most undecoded new data and decode it into the timeline. */
const tryDecodeRuns = async () => {
  // Decodes run on the dedicated fixed-rate context (see DECODE_SAMPLE_RATE), which also
  // works before the shared analyser context exists (resumed-at-startup tracks).
  const actx = getDecodeContext();
  if (!actx || !video) return;
  if (decoding) {
    // Safety net: if a decode somehow never settled, don't wedge the pipeline forever
    // (that was one way the whole thing "stopped working" until a restart). Expire it: its
    // result will be ignored, and its run goes back to "needs decoding" so the data isn't lost.
    if (performance.now() - decodingStartedAt <= 5000) return;
    if (
      decodeRun &&
      decodeRun.bytes === decodeRun.lastDecodedBytes &&
      slowDecodeWaits < MAX_SLOW_DECODE_WAITS
    ) {
      // The in-flight decode is slow but working on the same bytes (nothing new arrived):
      // grant it another window instead of resubmitting the identical snapshot — both results
      // would fail the attempt check and the samples would be lost, plus the redundant decode
      // loads the decoder for nothing.
      slowDecodeWaits++;
      decodingStartedAt = performance.now();
      return;
    }
    slowDecodeWaits = 0;
    decodeAttempt++;
    decoding = false;
    // Bound retries for the SAME snapshot: decodeAudioData can't be cancelled, so each
    // expiry leaves native work outstanding. After a couple of expired attempts on the
    // same bytes, give up on that run (live sampling covers it) and let the selector move
    // on to a different, smaller run instead of resubmitting the same oversized snapshot.
    if (decodeRun) {
      if (stalledRun === decodeRun && stalledBytes === decodeRun.bytes) {
        stalledTries++;
      } else {
        stalledRun = decodeRun;
        stalledBytes = decodeRun.bytes;
        stalledTries = 1;
      }
      if (stalledTries > MAX_STALLED_TRIES) {
        decodeRun.failed = true;
        decodeRun.lastDecodedBytes = decodeRun.bytes; // selector skips it now
        decodeRun.decoding = undefined; // a terminal failure must not keep dependents waiting
        stalledRun = null;
        stalledTries = 0;
      } else {
        decodeRun.lastDecodedBytes = decodeRun.decodedBytes ?? 0;
      }
    }
  }
  // Place audio on the timeline only against the authoritative duration, the one drawing and
  // seeking use. A fallback estimate can still be refined by the player; buckets placed on it
  // would sit on a different grid from the slider and could never be corrected (they are
  // write-once).
  const trackDur = authoritativeDuration();
  if (!isFinite(trackDur) || trackDur <= 0) return;

  const { pick, dropped } = pickRunToDecode(runs, currentRun, {
    minDecodeBytes: MIN_DECODE_BYTES,
    minNewBytes: MIN_NEW_BYTES,
  });
  // A continuation whose predecessor failed to decode can never be placed (its start depends
  // on where that one ends) — release it instead of letting it wait forever. If that leaves
  // the growing run without a resolvable start, restart capture so later appends land in a
  // fresh, placeable run instead of piling into one the selector discards forever.
  for (const lost of dropped) {
    lost.failed = true;
    lost.chunks = [];
    lost.decoding = undefined;
  }
  if (
    currentRun &&
    (followState(currentRun) === 'drop' || !chainIntact(currentRun))
  ) {
    retireCurrentRun('predecessor-failed');
  }
  if (!pick) return;
  const target = pick.run;
  const targetIdx = pick.index;

  decoding = true;
  decodingStartedAt = performance.now();
  const gen = trackGen; // snapshot: discard this decode if the track changes mid-await
  const attempt = ++decodeAttempt;
  slowDecodeWaits = 0; // a fresh attempt gets a fresh slow-decode allowance
  const run = target;
  decodeRun = run;
  // Mark the in-flight attempt on the run itself: dependents keep waiting while a retry
  // is unsettled instead of treating the earlier failure as terminal (see followState).
  // Cleared below when THIS attempt settles — never by an expired attempt.
  run.decoding = attempt;
  const bytesAtDecode = run.bytes;
  run.lastDecodedBytes = run.bytes;
  try {
    const merged = new Uint8Array(run.bytes);
    let offset = 0;
    for (const chunk of run.chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    const audioBuffer = await actx.decodeAudioData(
      merged.buffer.slice(0),
    );
    // Track changed while we were decoding → this run belongs to the previous track. Drop it
    // so we never write stale audio into the new track's (reset) timeline. Likewise drop a
    // decode the watchdog already expired. (finally still runs.)
    if (gen !== trackGen || attempt !== decodeAttempt) return;
    // Resolve the run's timeline start ONCE (from the seek target), then cache it.
    // Never re-derive from video.buffered — merged ranges make it snap the seeked
    // audio back to 0 and corrupt the start of the track.
    const firstDecode = run.start === undefined;
    // A continuation starts where its (fully decoded) predecessor ends; any other run starts
    // at its seek target. A start snapped to a merged range is only an estimate — mark it
    // so its buckets stay provisional (replaceable) instead of definitive.
    if (run.start === undefined) {
      if (run.follows) {
        run.start = continuationStart(run.follows);
        // A continuation inherits its predecessor's placement confidence: starting from an
        // estimated position shifts every bucket, so it must stay provisional too.
        run.startEstimated = !!run.follows.startEstimated;
      } else {
        const aligned = alignedRunStart(
          run.seekTarget,
          trackDur,
          run.evidence ?? null,
        );
        run.start = aligned.start;
        // Never DOWNGRADE confidence: a run already flagged estimated (e.g. a replacement
        // init placed at the playhead) must stay provisional even if the range looks ok.
        run.startEstimated = !!run.startEstimated || !aligned.confident;
      }
    }
    const start = run.start;
    run.decodedSec = audioBuffer.duration;
    run.decodedBytes = bytesAtDecode;
    run.failed = false;
    if (stalledRun === run) { stalledRun = null; stalledTries = 0; stalledBytes = -1; }
    // Placed: its start is final, so it no longer depends on its predecessor. Letting go of the
    // reference lets finished runs (and their chunks) be garbage-collected instead of being
    // kept alive through the whole chain of continuations.
    run.follows = undefined;
    wfLog('decode', {
      runIdx: targetIdx,
      ofRuns: runs.length,
      firstDecode, // false = re-decoding a growing run (watch placeRun.overwritten)
      seekTarget: Math.round(run.seekTarget),
      startSec: Math.round(start),
      kb: Math.round(bytesAtDecode / 1024),
      decodedSec: Math.round(audioBuffer.duration),
      chunks: run.chunks.length,
    });
    placeRun(audioBuffer, start, trackDur, !run.startEstimated);

    const snap = filledSpans();
    (window as unknown as { __waveformDebug?: unknown }).__waveformDebug = {
      build: WF_BUILD,
      runs: runs.length,
      lastRunStart: Math.round(start),
      lastRunSeconds: Math.round(audioBuffer.duration),
      filledPct: snap.pct,
      spans: snap.spans,
    };
    wfLog('state', { filled: snap.pct, spans: snap.spans });
  } catch (err) {
    // Fragmented/unsupported blob for this run — leave it; live fill covers the gap. (An
    // expired attempt's failure says nothing about the run any more.)
    if (attempt === decodeAttempt) run.failed = true;
    wfLog('decode FAILED', {
      runIdx: targetIdx,
      seekTarget: Math.round(run.seekTarget),
      kb: Math.round(bytesAtDecode / 1024),
      chunks: run.chunks.length,
      err: String(err),
    });
  } finally {
    // Only the live attempt may clear the busy flag, the retry marker, or free chunks; an
    // expired one must not interfere with the decode that replaced it.
    if (attempt === decodeAttempt) {
      decoding = false;
      decodeRun = null;
      if (run.decoding === attempt) run.decoding = undefined;
      // A run that is no longer the growing `currentRun` will never get new bytes (the
      // append hook only feeds currentRun), so once decoded we free its chunks. This keeps
      // retained audio bounded to ~one in-flight run instead of up to MAX_RUN_BYTES × MAX_RUNS.
      // Only free when that decode covered every byte: if the run received more audio while we
      // were decoding and was then sealed (e.g. by a seek), that tail is still waiting to be
      // analysed and the run stays eligible for one last decode. And never free while one of
      // the run's appends is still unconfirmed — its bytes would be released before any decode
      // saw them, and the final decode would read freed (zeroed) ground.
      if (
        shouldFreeChunks(run === currentRun, run) &&
        (pendingByRun.get(run) ?? 0) === 0
      )
        run.chunks = [];
    }
  }
};

/**
 * The track's canonical length from the player's metadata (`videoDetails.lengthSeconds`), which
 * is fixed from load. NaN until the player response is available. Audio is placed on the
 * timeline only against this value (see tryDecodeRuns), so placement, drawing and seeking always
 * share one grid; the fallbacks in trackDuration() are only for drawing before it is ready.
 */
const authoritativeDuration = (): number => {
  try {
    const resp = playerApi?.getPlayerResponse?.() as
      | { videoDetails?: { lengthSeconds?: string | number } }
      | undefined;
    const len = Number(resp?.videoDetails?.lengthSeconds);
    if (isFinite(len) && len > 0) return len;
  } catch {
    /* ignore */
  }
  return NaN;
};

/**
 * The REAL, stable track duration — the value the player displays. `video.duration`
 * grows as YouTube refines its estimate while buffering (e.g. 438→454s), which shifts the
 * timeline mapping mid-track. The player's metadata length (`videoDetails.lengthSeconds`)
 * is the canonical track length and is fixed from load, so prefer it; fall back to the
 * player API's getDuration(), then to video.duration. Returns NaN if none are ready yet.
 */
const trackDuration = (): number => {
  const authoritative = authoritativeDuration();
  if (isFinite(authoritative)) return authoritative;
  try {
    const st = playerApi?.getProgressState?.();
    if (st && isFinite(st.duration) && st.duration > 0) return st.duration;
  } catch {
    /* ignore */
  }
  const d = playerApi?.getDuration?.();
  if (typeof d === 'number' && isFinite(d) && d > 0) return d;
  const vd = video?.duration ?? NaN;
  return isFinite(vd) && vd > 0 ? vd : NaN;
};

/**
 * The REAL playback position, from the player API — NOT `video.currentTime`. YTM can hold a
 * stale or second <video> (radio/automix transitions, video-toggle, ads); a cached element
 * then freezes, so the played marker sticks mid-strip and a click seeks a dead element (the
 * audio never moves). getProgressState()/getCurrentTime() always reflect the element that is
 * actually producing audio. Falls back to the cached <video> only if the API isn't ready.
 */
const playbackPosition = (): number => {
  try {
    const st = playerApi?.getProgressState?.();
    if (st && isFinite(st.current) && st.current >= 0) return st.current;
  } catch {
    /* ignore */
  }
  const t = playerApi?.getCurrentTime?.();
  if (typeof t === 'number' && isFinite(t) && t >= 0) return t;
  return video?.currentTime ?? 0;
};

// Track identity comes from the player API's current videoDetails — authoritative and
// stable within a track, and it changes on every real track change regardless of the URL
// or the now-playing page state. This replaces the old URL `?v=` sticky hack, which went
// stale (URL loses `v` when you browse elsewhere) and then NEVER let go: the key stopped
// changing, so a new track never reset — the old waveform stayed pegged and new seeks hit
// an already-filled (write-once) timeline, so they appeared dead until a plugin restart.
// Falls back to the URL only before the API is ready.
const currentVideoId = (): string | null => {
  try {
    const resp = playerApi?.getPlayerResponse?.() as
      | { videoDetails?: { videoId?: string } }
      | undefined;
    const id = resp?.videoDetails?.videoId;
    if (id) return id;
  } catch {
    /* ignore */
  }
  return new URLSearchParams(window.location.search).get('v');
};

// Decode sample rate, FIXED: decodeAudioData resamples to the decoding context's rate, so a
// device-rate context (96/192 kHz DACs) would multiply PCM memory for the same track. The
// backend's PCM budget assumes this rate, and all decodes (progressive + full) go through
// the context below — the shared analyser context is only used for live sampling.
const DECODE_SAMPLE_RATE = 48000;
// Mirror of the backend's MAX_PCM_BYTES: skip the fetch when the track at THIS context's
// (actual) rate would exceed it, so we don't download bytes we will refuse to decode.
const MAX_FULL_PCM_BYTES = 768 * 1024 * 1024;
// A context just for decoding bytes. The shared analyser context (`audioContext`) is only
// set when `peard:audio-can-play` fires — which we can MISS on a track resumed at startup —
// so decoding must not depend on it.
let decodeContext: AudioContext | null = null;
const getDecodeContext = (): AudioContext | null => {
  if (decodeContext) return decodeContext;
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    try {
      decodeContext = new Ctor({ sampleRate: DECODE_SAMPLE_RATE });
    } catch {
      // Very old backend: fixed rate unsupported — fall back to the device default. The
      // pre-decode estimate below uses the context's ACTUAL rate, so it stays safe.
      decodeContext = new Ctor();
    }
  } catch {
    decodeContext = null;
  }
  return decodeContext;
};

/**
 * Fetch the whole track once (via the backend's lightweight Innertube fetch — no
 * Downloader plugin needed), decode it, and fill every bucket so the strip is complete
 * and stable. Shared by the opt-in full mode and the progressive-path auto-fallback.
 * Silently no-ops if the audio can't be retrieved, leaving the progressive path running.
 */
// Bound for one full decode: a decodeAudioData that never settles must not hold
// `fullFetching` forever (the backend deadlines and the progressive watchdog don't cover
// this await) and block full fetches for later tracks.
const FULL_DECODE_TIMEOUT_MS = 60000;
const runFullFetch = async (key: string, reason: 'full' | 'auto-fallback') => {
  if (fullDecoded || fullFetching || !ipcRenderer) return;
  const actx = getDecodeContext();
  if (!actx) {
    console.info('[Waveform] no AudioContext to decode with; skip fetch');
    return;
  }
  const videoId = currentVideoId();
  if (!videoId) {
    console.info('[Waveform] no videoId in URL; skip fetch');
    return;
  }

  // Length cap: don't pull a multi-hour live set / DJ mix over the network. Apply it to the
  // AUTHORITATIVE length only (`videoDetails.lengthSeconds`) — not the player's temporary
  // estimate, which can read 29 min for a 31 min track (or a too-short provisional that
  // would wrongly mark the track as "attempted"). Wait for it instead of guessing. 0 =
  // unlimited.
  const capMin = config.maxFullMinutes ?? 30;
  const dur = authoritativeDuration();
  if (capMin > 0 && !isFinite(dur)) return; // wait for canonical metadata; retried each frame
  if (capMin > 0 && dur > capMin * 60) {
    console.info(
      `[Waveform] ${reason}: track ${Math.round(dur)}s over ${capMin}min cap; using progressive`,
    );
    fullFetchKey = key; // mark attempted so we don't re-check every frame
    fullFetchGen = trackGen;
    return;
  }

  // Pre-decode PCM guard (mirrors the backend's MAX_PCM_BYTES, but with THIS context's actual
  // rate — decodeAudioData resamples to it): skip the fetch when the track would exceed it, so
  // we don't download bytes we will refuse to decode. Unknown duration falls through; the
  // backend (which knows the real length) still decides.
  const gridForBudget = authoritativeDuration();
  if (
    isFinite(gridForBudget) &&
    gridForBudget > 0 &&
    gridForBudget * actx.sampleRate * 2 * 4 > MAX_FULL_PCM_BYTES
  ) {
    console.info(
      `[Waveform] ${reason}: ~${Math.round(gridForBudget)}s at ${actx.sampleRate}Hz exceeds the PCM budget; using progressive`,
    );
    fullFetchKey = key;
    fullFetchGen = trackGen;
    return;
  }

  fullFetchKey = key; // mark this track attempted, so we don't fetch it twice
  fullFetchGen = trackGen;
  fullFetching = true;
  const myFetch = ++fullFetchSeq; // only this attempt may release the busy flag
  const gen = trackGen; // bumped on a track change AND on stop(): discard the result if it moved
  console.info(`[Waveform] ${reason}: fetching full track ${videoId}…`);
  try {
    const res = (await ipcRenderer.invoke('waveform:fetch-audio', videoId)) as
      | { data: ArrayBuffer }
      | { error: string; status?: string; poToken?: boolean }
      | null;
    if (!res || !('data' in res) || !res.data) {
      // fullFetchKey stays set, so the track isn't retried on its own (progressive carries it);
      // turning Full waveform off and on again clears it (see onConfigChange) to try again.
      const err = res && 'error' in res ? res : { error: 'no-response' };
      console.info('[Waveform] full fetch failed →', err); // reason visible in DevTools
      return;
    }
    const buf = res.data;
    if (currentTrackKey() !== key || gen !== trackGen) return; // track changed / plugin stopped
    // The user may have LOWERED the cap while the fetch was in flight: re-check before
    // spending a full decode on a track that is now over the limit (it would be discarded
    // later anyway, but only after decoding).
    const capNowCheck = (): boolean => {
      const cap = config.maxFullMinutes ?? 30;
      const d = authoritativeDuration();
      return cap <= 0 || !isFinite(d) || d <= cap * 60;
    };
    if (!capNowCheck()) {
      console.info(
        `[Waveform] ${reason}: cap changed below this track while fetching; discarding`,
      );
      return;
    }
    console.info(
      `[Waveform] got ${Math.round(buf.byteLength / 1024)}KB, decoding…`,
    );
    const decodePromise = actx.decodeAudioData(buf.slice(0));
    let audioBuffer: AudioBuffer;
    try {
      audioBuffer = await Promise.race([
        decodePromise,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('full decode timed out')),
            FULL_DECODE_TIMEOUT_MS,
          ),
        ),
      ]);
    } catch (err) {
      // Timeout or decode error: the late result (if any) is ignored, `fullFetching` is
      // released by the finally below, and progressive keeps rendering this track.
      decodePromise.catch(() => undefined);
      console.info('[Waveform] full fetch/decode failed; using progressive:', err);
      return;
    }
    if (currentTrackKey() !== key || gen !== trackGen) return;

    const chans: Float32Array[] = [];
    for (let c = 0; c < Math.min(2, audioBuffer.numberOfChannels); c++) {
      chans.push(audioBuffer.getChannelData(c));
    }
    // The toggle that authorized this fetch may have been switched off while it was in
    // flight — a pending result must not then replace progressive data or stop its analysis.
    // Turning the option back on clears fullFetchKey (see onConfigChange) so it can retry.
    if (reason === 'full' ? !config.fullWaveform : !config.autoFullFallback) {
      console.info(
        `[Waveform] ${reason} no longer enabled; discarding fetched audio`,
      );
      return;
    }
    // ...and re-check the length cap after decoding, right before installing.
    if (!capNowCheck()) {
      console.info(
        `[Waveform] ${reason}: cap changed below this track; keeping progressive`,
      );
      return;
    }
    // Place the buckets on the grid the slider uses (the track's metadata length). Small
    // rounding/encoder-delay differences are tolerated; a bigger gap means the download is a
    // different cut, and installing it would misalign every seek — keep the progressive
    // waveform (which is built from the player's own audio, so it always matches) instead.
    const decodedSec = audioBuffer.duration;
    const gridSec = authoritativeDuration();
    const tolerance = Math.max(2, gridSec * 0.02);
    if (
      !isFinite(gridSec) ||
      Math.abs(gridSec - decodedSec) > tolerance
    ) {
      console.info(
        `[Waveform] ${reason}: decoded ${Math.round(decodedSec)}s vs player ${Math.round(gridSec)}s — different cut; keeping progressive`,
      );
      return;
    }
    const full = computeFullPeaks(
      chans,
      audioBuffer.sampleRate,
      gridSec,
      RES,
    );
    // Install bucket-by-bucket, keeping progressive data where the full decode has no
    // samples (a 99 s decode on a 100 s grid must not wipe a progressively-filled tail
    // bucket — progressive analysis stops here, so the gap would persist forever). A full
    // decode covering the whole grid still replaces every progressive bucket.
    // Loudest RMS body over the whole track → settles the running normalization reference.
    // Computed over buckets the merge actually keeps (installed full buckets plus retained
    // progressive ones), so a provisional live-inflated value can't dim the strip.
    const bucketDur = gridSec / RES;
    let wroteAny = false;
    for (let b = 0; b < RES; b++) {
      if (!full.filled[b]) continue;
      // A partial tail bucket the full decode merely touches must not wipe a complete
      // progressive measurement; keep the progressive bucket and stay replaceable.
      const fullyCovered = (b + 1) * bucketDur <= decodedSec + BUCKET_COVER_EPS;
      if (!fullyCovered && filledMask[b] === 1) continue;
      peaksArr[b] = full.peaks[b];
      peaksMaxArr[b] = full.peaksMax[b];
      bandsArr.set(full.bands.subarray(b * 3, b * 3 + 3), b * 3);
      if (fullyCovered) {
        filledMask[b] = 1;
        liveMask[b] = 0;
      } else {
        liveMask[b] = 1;
      }
      wroteAny = true;
    }
    if (wroteAny) {
      let mx = 0;
      for (let i = 0; i < RES; i++)
        if (filledMask[i] === 1 && peaksArr[i] > mx) mx = peaksArr[i];
      if (mx > 0) normRefBody = mx;
    }
    waveformRev++; // the strip changed wholesale — repaint even if paused
    // Keep the SAME amplitude scale the progressive path used (DECODE_GAIN). The full path
    // computes RMS identically, so the buckets already drawn progressively keep their exact
    // height and position when the complete waveform swaps in — no jump/reflow on load.
    // (We deliberately do NOT switch to full.peakScale's per-track normalization here.)
    peakScale = DECODE_GAIN;
    // Only declare the track COMPLETE when the merged timeline has DEFINITIVE coverage
    // everywhere — live estimates don't count, since no later decode could correct them
    // once progressive analysis stops.
    let uncovered = 0;
    for (let b = 0; b < RES; b++) if (filledMask[b] !== 1) uncovered++;
    const complete = uncovered === 0;
    if (complete) {
      fullDecoded = true;
      // A same-track progressive decode may still be in flight (or queued behind the runs
      // we just cleared): invalidate it so a late result can't write into the timeline or
      // raise normRefBody and shift bars already drawn.
      decodeAttempt++;
      slowDecodeWaits = 0;
      decoding = false;
      decodeRun = null;
      // Progressive capture is done: drop its queue (each rollover retains its undecoded
      // predecessor through `follows`) and stop recording further appends.
      runs.length = 0;
      currentRun = null;
    } else {
      // Coverage is incomplete: keep progressive capture/decoding alive so the remaining
      // buckets can still be filled (full buckets are already definitive and untouched).
      console.info(
        `[Waveform] ${reason}: full decode left ${uncovered} buckets uncovered; progressive continues`,
      );
    }

    let filled = 0;
    for (let i = 0; i < RES; i++) filled += filledMask[i];
    (window as unknown as { __waveformDebug?: unknown }).__waveformDebug = {
      mode: reason,
      seconds: Math.round(audioBuffer.duration),
      peakScale: Math.round(peakScale * 100) / 100,
      filledPct: Math.round((filled / RES) * 100) + '%',
    };
    console.info(
      `[Waveform] ${reason} done — ${Math.round(audioBuffer.duration)}s decoded`,
    );
  } catch (err) {
    // Fetch/decode failed — progressive keeps running for this track (hybrid).
    console.info(
      '[Waveform] full fetch/decode failed; using progressive:',
      err,
    );
  } finally {
    // Release the busy flag only if this attempt still owns it: a disable → re-enable
    // cycle can start a new fetch while the old one is still settling, and the old
    // finally must not clear the new attempt's flag (that would let a third fetch
    // start while the second is still active).
    if (myFetch === fullFetchSeq) fullFetching = false;
  }
};

/** Opt-in full-waveform: fetch up front on every track. */
const maybeFetchFull = () => {
  if (!config.fullWaveform || fullDecoded || fullFetching || !ipcRenderer)
    return;
  const key = currentTrackKey();
  // Same-visit suppression only (see maybeAutoFallback). Also wait for metadata: without
  // a duration the length cap can't be enforced (a 31-minute track could download despite
  // a 30-minute cap). Retried every frame once the duration is known.
  if (!key || (key === fullFetchKey && trackGen === fullFetchGen)) return;
  if (!isFinite(authoritativeDuration())) return;
  runFullFetch(key, 'full').catch(() => undefined);
};

/**
 * Progressive-path safety net: only when the track has played a few seconds yet almost
 * nothing decoded (resumed mid-track / cached / missed buffer), fetch it once. Normal
 * fresh plays fill quickly and never reach the trigger.
 */
const maybeAutoFallback = () => {
  if (
    !config.autoFullFallback ||
    fullDecoded ||
    fullFetching ||
    !ipcRenderer ||
    !video
  ) {
    return;
  }
  const key = currentTrackKey();
  // Suppress only a same-visit attempt (key AND generation match): a fetch from an earlier
  // visit that settled without installing must not block a retry after returning.
  if (!key || (key === fullFetchKey && trackGen === fullFetchGen)) return; // already fetched/attempted this track
  // The coverage grid (and the length cap inside runFullFetch) both need the canonical
  // duration; a provisional estimate would make the trigger unreliable. Wait for it.
  const dur = authoritativeDuration();
  if (!isFinite(dur) || dur <= 0) return;
  const playedRes = bucketForProgress(playbackPosition() / dur, RES);
  const cov = playedCoverage(filledMask, liveMask, playedRes);
  // Playing time accumulated while the position actually advances (pauses and buffering
  // stalls don't count): a paused cached track never reaches the trigger.
  if (shouldAutoFetchFull(cov, playingMs)) {
    runFullFetch(key, 'auto-fallback').catch(() => undefined);
  }
};

const attachAnalyser = (detail: Compressor) => {
  const { audioContext: ctx, audioSource } = detail;
  // Rebind when EITHER the context or the source node changes: a video toggle can hand us a
  // different source on the SAME context, and keeping the old tap would sample the previous
  // element (silence or the wrong track) into the waveform.
  if (audioContext !== ctx || !analyser || audioSourceNode !== audioSource) {
    // Drop the previous tap (only ours) before connecting the new source.
    try {
      if (audioSourceNode && analyser) audioSourceNode.disconnect(analyser);
    } catch {
      /* already disconnected */
    }
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0;
    audioSource.connect(analyser);
    audioSourceNode = audioSource;
    audioContext = ctx;
    timeData = new Uint8Array(analyser.fftSize);
    lastLiveBucket = -1; // new tap: restart the contiguity chain
  }
};

/**
 * Fill the timeline bucket under the playhead from the live analyser — WRITE-ONCE, into
 * the same absolute-time arrays the decoder uses. This is what makes the waveform
 * "eventually fill out all the bars": simply playing through any region (a decode failure,
 * an un-buffered gap, a spot the runs missed) records it permanently, and because it's
 * write-once it never moves. Contiguous playback gap-fills skipped buckets between frames.
 */
const sampleLivePlayhead = () => {
  if (!analyser || !timeData || !video || video.paused) {
    lastLiveBucket = -1; // playback stopped/seeked — break the contiguity chain
    return;
  }
  // Same grid the slider uses (see authoritativeDuration), so live-filled buckets line up.
  const dur = authoritativeDuration();
  if (!isFinite(dur) || dur <= 0) return;

  analyser.getByteTimeDomainData(timeData);
  if (!liveFloat || liveFloat.length !== timeData.length) {
    liveFloat = new Float32Array(timeData.length);
  }
  for (let i = 0; i < timeData.length; i++)
    liveFloat[i] = (timeData[i] - 128) / 128;
  const a = analyzeBucket([liveFloat], 0, liveFloat.length);

  const b = bucketForProgress(playbackPosition() / dur, RES);
  const write = (idx: number) => {
    if (idx < 0 || idx >= RES || filledMask[idx]) return; // definitive decoded data wins
    peaksArr[idx] = a.rms;
    if (a.rms > normRefBody) normRefBody = a.rms; // running loudness ref for normalization
    peaksMaxArr[idx] = a.peak;
    const bi = idx * 3;
    bandsArr[bi] = a.low;
    bandsArr[bi + 1] = a.mid;
    bandsArr[bi + 2] = a.high;
    liveMask[idx] = 1; // provisional — a later decode covering it fully still replaces it
    waveformRev++;
  };
  // During contiguous playback the playhead may cross several buckets between frames;
  // fill them so there are no 1-bucket gaps. A big jump = a seek, so don't bridge it.
  if (lastLiveBucket >= 0 && b > lastLiveBucket && b - lastLiveBucket <= 12) {
    for (let k = lastLiveBucket + 1; k <= b; k++) write(k);
  } else {
    write(b);
  }
  lastLiveBucket = b;
};

/** Sample the average colour of the current cover art (best-effort; CORS may block). */
// Album art is served cross-origin (googleusercontent), and YTM's own <img> has no
// crossorigin attribute — drawing it to a canvas TAINTS the canvas, so getImageData throws
// and the colour could never update. We instead load the same URL through a fresh
// crossOrigin='anonymous' image (the CDN returns CORS headers), which gives an untainted
// canvas we can read. Async + de-duped by src, so it samples once per track.
const sampleAlbumColor = () => {
  const img = document.querySelector<HTMLImageElement>(
    'ytmusic-player-bar img',
  );
  const src = img?.src;
  if (!src || src === albumColorSrc || src === albumColorLoading) return;
  albumColorLoading = src;
  const probe = new Image();
  probe.crossOrigin = 'anonymous';
  probe.onload = () => {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 8;
      const cx = c.getContext('2d');
      if (!cx) return;
      cx.drawImage(probe, 0, 0, 8, 8);
      const d = cx.getImageData(0, 0, 8, 8).data;
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      for (let i = 0; i < d.length; i += 4) {
        r += d[i];
        g += d[i + 1];
        b += d[i + 2];
        count++;
      }
      if (count) {
        albumColor = `rgb(${(r / count) | 0},${(g / count) | 0},${(b / count) | 0})`;
      }
      albumColorSrc = src;
    } catch {
      /* still tainted somehow — keep the previous colour, don't retry this src */
      albumColorSrc = src;
    } finally {
      if (albumColorLoading === src) albumColorLoading = null;
    }
  };
  probe.onerror = () => {
    // Record the failed src so a frame doesn't start a new probe for the same URL on every
    // draw (the retry-every-frame loop). A different URL still starts probing immediately.
    // (Transient failures keep the previous colour — same as the tainted-canvas path above.)
    albumColorSrc = src;
    if (albumColorLoading === src) albumColorLoading = null;
  };
  probe.src = src;
};

const playerBgColor = (): string => {
  let el: HTMLElement | null = playerBar;
  for (let i = 0; el && i < 4; i++) {
    const bg = getComputedStyle(el).backgroundColor;
    if (bg && bg !== 'transparent' && !bg.startsWith('rgba(0, 0, 0, 0'))
      return bg;
    el = el.parentElement;
  }
  return 'rgb(3,3,3)';
};

const positionCanvas = () => {
  if (!canvas || !playerBar) return;
  const rect = playerBar.getBoundingClientRect();
  const width = window.innerWidth; // full window width, not the (inset) player bar
  const dpr = window.devicePixelRatio || 1;
  const targetW = Math.max(1, Math.floor(width * dpr));
  const targetH = Math.max(1, Math.floor(config.height * dpr));

  canvas.style.left = '0px';
  // CRITICAL for seamless continuity: the CSS size must equal backing/dpr EXACTLY, so the
  // integer backing store maps 1:1 to physical pixels. Using innerWidth (≠ floor(w*dpr)/dpr)
  // made the compositor upscale the whole canvas by ~1.0003 and interpolate it, which put a
  // faint seam on every column. Deriving CSS size from the integer backing removes that.
  canvas.style.width = `${targetW / dpr}px`;
  canvas.style.height = `${targetH / dpr}px`;
  canvas.style.bottom = `${window.innerHeight - rect.top}px`;

  if (targetW !== backingW || targetH !== backingH) {
    canvas.width = targetW;
    canvas.height = targetH;
    backingW = targetW;
    backingH = targetH;
  }
};

const ensureCanvas = (): boolean => {
  if (canvas?.isConnected && playerBar?.isConnected) return true;

  // The player bar was replaced (or this is the first mount): drop the old overlay and
  // its active state first, so a stale canvas can't stay in the DOM or the tab order
  // after its bar is gone. Also invalidate the paint signature — the fresh canvas has
  // nothing painted yet even if the new state matches the old one.
  canvas?.remove();
  canvas = null;
  ctx2d = null;
  backingW = backingH = 0;
  playerBar?.classList.remove('waveform-seekbar-active');
  lastPaintSig = '';
  lastAriaSec = -1;
  lastAriaDur = -1;

  playerBar = document.querySelector<HTMLElement>('ytmusic-player-bar');
  const progressBar = document.querySelector<HTMLElement>('#progress-bar');
  video ??= document.querySelector<HTMLVideoElement>('video');
  if (!playerBar || !progressBar || !video) {
    playerBar = null;
    return false;
  }

  canvas = document.createElement('canvas');
  canvas.id = 'waveform-seekbar';
  // A fresh canvas has no aria values yet; force the next draw to write them even if playback
  // is still on the same second as before.
  lastAriaSec = -1;
  lastAriaDur = -1;
  // Accessible slider: the canvas replaces the (now hidden) native progress bar, so once
  // a duration is known it must be focusable, expose slider semantics, and be operable
  // from the keyboard. Until then it is a non-focusable placeholder (a slider with no
  // value or working keys would mislead assistive technology).
  canvas.tabIndex = -1;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Loading waveform');
  canvas.setAttribute('aria-valuemin', '0');
  canvas.setAttribute('aria-valuemax', '100');
  canvas.setAttribute('aria-valuenow', '0');

  // Seek through the player API (authoritative): it moves the element actually playing. Setting
  // a cached <video>.currentTime can hit a stale element and never move the audio.
  const seekTo = (target: number) => {
    const dur = trackDuration();
    if (!isFinite(dur) || dur <= 0) return;
    const clamped = Math.min(dur, Math.max(0, target));
    if (playerApi?.seekTo) playerApi.seekTo(clamped);
    else if (video) video.currentTime = clamped;
  };

  canvas.addEventListener('click', (e: MouseEvent) => {
    const dur = trackDuration();
    if (!isFinite(dur) || dur <= 0) return;
    const rect = canvas!.getBoundingClientRect();
    const ratio = Math.min(
      1,
      Math.max(0, (e.clientX - rect.left) / rect.width),
    );
    seekTo(ratio * dur); // same duration the waveform is drawn with
  });

  canvas.addEventListener('keydown', (e: KeyboardEvent) => {
    const dur = trackDuration();
    if (!isFinite(dur) || dur <= 0) return;
    const pos = playbackPosition();
    let target: number;
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        target = pos - 5;
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        target = pos + 5;
        break;
      case 'PageDown':
        target = pos - 30;
        break;
      case 'PageUp':
        target = pos + 30;
        break;
      case 'Home':
        target = 0;
        break;
      case 'End':
        target = dur;
        break;
      default:
        return;
    }
    e.preventDefault();
    seekTo(target);
  });

  playerBar.style.setProperty(
    '--waveform-seekbar-height',
    `${config.height}px`,
  );
  // Mount on <body>. <ytmusic-app> is position:static with z-index:auto, so it does NOT
  // create a stacking context — our body-level fixed canvas and all of YTM's chrome share
  // the SAME root stacking context, and plain z-index ordering is enough to place the
  // waveform above the sidebar (z-index 4) yet below YTM's toast / ⋮ overlays. (Appending the
  // canvas inside <ytmusic-app> instead disturbed YTM's own rendering, so we don't.)
  document.body.appendChild(canvas);
  ctx2d = canvas.getContext('2d');
  if (!ctx2d) {
    // No 2D context: the canvas can't draw or replace the native control. Leave the
    // native progress bar visible instead of hiding a control that would leave no slider.
    canvas.remove();
    canvas = null;
    playerBar.classList.remove('waveform-seekbar-active');
    return false;
  }
  backingW = backingH = 0;
  positionCanvas();
  return true;
};

const draw = () => {
  if (!canvas || !video) return;
  if (!ctx2d) {
    playerBar?.classList.remove('waveform-seekbar-active');
    return;
  }
  positionCanvas();

  // (Track-change reset lives in loop(), which runs every frame even when painting is
  // skipped while paused.)
  const theme = THEMES[config.theme] ?? THEMES.soundcloud;
  if (theme.mode === 'album') sampleAlbumColor();

  // Draw in DEVICE pixels (undo the dpr transform positionCanvas set) so every 1px column
  // lands on the real pixel grid and tiles with NO sub-pixel anti-aliasing seam. On a
  // fractional-DPR screen (e.g. 150% scaling) 1-CSS-px columns fell between device pixels
  // and left the micro-gaps you saw — Rekordbox waveforms are perfectly continuous.
  const dpr = window.devicePixelRatio || 1;
  ctx2d.setTransform(1, 0, 0, 1, 0, 0);
  const cssWidth = backingW; // now in device px
  const cssHeight = backingH;

  // Render style follows the user's setting for EVERY theme, including the Rekordbox ones:
  // 'filled' = a dense continuous 1-device-px waveform (the Pioneer-CDJ look), 'bars' =
  // separated bars at the configured width/gap. Shape (centre-mirrored vs bottom) is
  // independent. Bar width/gap scale by DPR.
  const filledRender = config.render === 'filled';
  // Continuous render = tiny smoothing so the dense per-column peak detail (RB texture)
  // survives; bars are wide, so smooth them more into a single readable envelope.
  const smoothR = filledRender ? 1 : 3;
  // Colour balance: shift the low↔high emphasis for the frequency-coloured modes so loud,
  // bass-heavy sections aren't forced all-red. cb<1 lifts mid/high (cooler), cb>1 warms.
  const cb = config.colorBalance ?? 1;
  const gLow = G_LOW * cb;
  const gMid = G_MID;
  const gHigh = G_HIGH / cb;
  const centered = config.shape !== 'bottom';
  const barW = filledRender
    ? 1
    : Math.max(1, Math.round(config.barWidth * dpr));
  const step = filledRender
    ? 1
    : barW + Math.max(1, Math.round(config.barGap * dpr));
  const bucketCount = Math.max(1, Math.floor(cssWidth / step));

  const duration = trackDuration();
  const hasDuration = isFinite(duration) && duration > 0;
  // Only hide the native progress bar once the canvas can actually act as the seek control
  // (valid duration + working keys). Until then the native control stays usable.
  playerBar?.classList.toggle('waveform-seekbar-active', hasDuration);
  const current = hasDuration ? playbackPosition() : 0;
  const progress = hasDuration ? current / duration : 0;
  const playedBucket = Math.floor(progress * bucketCount);

  // Keep the slider's accessible value in sync with playback (throttled to whole seconds).
  // Also refresh when the duration changes: two tracks of different length can both sit at 0:00,
  // and the second would otherwise keep reporting the first one's maximum.
  if (canvas && hasDuration) {
    // First valid duration: promote the loading placeholder to an operable slider.
    if (canvas.getAttribute('role') !== 'slider') {
      canvas.tabIndex = 0;
      canvas.setAttribute('role', 'slider');
      canvas.setAttribute('aria-label', 'Seek');
    }
    const sec = Math.floor(current);
    const durSec = Math.round(duration);
    if (sec !== lastAriaSec || durSec !== lastAriaDur) {
      lastAriaSec = sec;
      lastAriaDur = durSec;
      canvas.setAttribute('aria-valuemax', String(durSec));
      canvas.setAttribute('aria-valuenow', String(sec));
      canvas.setAttribute(
        'aria-valuetext',
        `${formatTime(current)} of ${formatTime(duration)}`,
      );
    }
  } else if (canvas && canvas.getAttribute('role') === 'slider') {
    // Duration gone (mid track transition): the canvas can no longer seek, so stop exposing
    // it as a focusable slider carrying the PREVIOUS track's values. The native bar is
    // restored by the class toggle above; the canvas becomes a non-focusable placeholder and
    // gets promoted again once the new duration is known.
    canvas.tabIndex = -1;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Loading waveform');
    canvas.setAttribute('aria-valuenow', '0');
    canvas.removeAttribute('aria-valuetext');
    lastAriaSec = -1;
    lastAriaDur = -1;
  }

  ctx2d.clearRect(0, 0, cssWidth, cssHeight);
  if (config.background === 'player') {
    ctx2d.fillStyle = playerBgColor();
    ctx2d.fillRect(0, 0, cssWidth, cssHeight);
  }

  // Rekordbox RGB: each slice coloured by its frequency balance — low→red, mid→green,
  // high→blue — with a contrast boost so the dominant band shows through vividly.
  if (theme.mode === 'rgb') {
    const half = cssHeight / 2;
    const bottom = !centered;
    for (let i = 0; i < bucketCount; i++) {
      const t = i / bucketCount;
      const played = i <= playedBucket;
      const x = i * step;
      const b = bucketForProgress(t, RES);

      let h: number;
      if (hasData(b)) {
        const sb = smoothBands(b);
        // bandColor normalizes internally by the dominant channel, so only the RELATIVE
        // gains matter here — the colour is a pure function of this bucket's spectrum.
        const traktor = theme.spectrumFlavor === 'traktor';
        const hGain = traktor ? gHigh * 1.5 : gHigh; // Traktor emphasises the highs more
        const col = bandColor(sb[0] * gLow, sb[1] * gMid, sb[2] * hGain);
        const r = col.r;
        const g = col.g;
        // Traktor renders mids as cyan (green + blue) rather than Rekordbox's pure green.
        const bb = traktor ? Math.min(255, col.b + Math.round(g * 0.6)) : col.b;
        const amp = ampFor(b, smoothR);
        h = Math.max(1, amp * half * config.heightScale);
        ctx2d.fillStyle = played
          ? `rgb(${r},${g},${bb})`
          : `rgba(${r},${g},${bb},0.4)`;
      } else {
        // No data yet (not decoded, not played through): a calm flat placeholder.
        // Split by playhead like data columns, so the strip still shows the playback
        // position when nothing has decoded yet (the native progress bar is hidden).
        h = Math.max(1, config.placeholderHeight * half * config.heightScale);
        ctx2d.fillStyle = played
          ? 'rgba(150,150,160,0.6)'
          : 'rgba(150,150,160,0.35)';
      }
      const fullH = h * 2;
      const y = bottom ? cssHeight - fullH : half - h;
      ctx2d.fillRect(x, y, barW, fullH);
    }
    return;
  }

  const LOW_COL = '10,132,255'; // blue — bass/kick
  const MID_COL = '255,159,10'; // amber — vocals/synths
  const HIGH_COL = '229,229,234'; // light grey/white — hats/cymbals
  const playedSolid = theme.mode === 'album' ? albumColor : theme.played;

  for (let i = 0; i < bucketCount; i++) {
    const t = i / bucketCount;
    const played = i <= playedBucket;
    const b = bucketForProgress(t, RES);

    let amp: number;
    let bl = 0;
    let bm = 0;
    let bh = 0;
    let haveBands = false;
    let dataless = false;

    if (hasData(b)) {
      amp = ampFor(b, smoothR);
      const sb = smoothBands(b);
      bl = sb[0];
      bm = sb[1];
      bh = sb[2];
      haveBands = true;
    } else {
      // No data yet: a calm flat placeholder (fills in as you play/seek through it).
      amp = config.placeholderHeight;
      dataless = true;
    }

    const barH = Math.max(2, amp * cssHeight * config.heightScale);
    const x = i * step;

    // Rekordbox 3-Band ("vector"): three overlaid, centre-mirrored band envelopes —
    // blue (low) / orange (mid) / white (high). Each band is scaled so the DOMINANT one
    // fills the full amplitude and the others show through it, giving the interleaved
    // Pioneer look (not a bottom-stacked bar).
    if (theme.mode === '3band') {
      const half = cssHeight / 2;
      const bottom = !centered;
      const alpha = played ? 1 : 0.4;
      const place = (h2: number) => {
        const fh = h2 * 2;
        ctx2d!.fillRect(x, bottom ? cssHeight - fh : half - h2, barW, fh);
      };
      if (!haveBands || dataless) {
        const ph = Math.max(
          1,
          config.placeholderHeight * half * config.heightScale,
        );
        // Playhead split like data columns: position stays visible with no data.
        ctx2d.fillStyle = played
          ? 'rgba(150,150,160,0.6)'
          : 'rgba(150,150,160,0.35)';
        place(ph);
        continue;
      }
      const hTotal = Math.max(1, amp * half * config.heightScale);
      // Apply the fixed per-band gains, then share the loudness envelope between the bands:
      // the band loudest after gain fills the envelope, the others nest inside at their
      // proportion — a bass drop bulges blue with a white transient core, a hi-hat run goes
      // bright white, like Rekordbox's 3-band view. Ratios only, so it's fully stable.
      const nl = bl * gLow;
      const nm = bm * gMid;
      const nh = bh * gHigh;
      const nMax = Math.max(nl, nm, nh, 1e-6);
      const bands: Array<[number, string]> = [
        [(nl / nMax) * hTotal, LOW_COL], // blue — bass
        [(nm / nMax) * hTotal, MID_COL], // orange — mids
        [(nh / nMax) * hTotal, HIGH_COL], // white — highs
      ];
      bands.sort((p, q) => q[0] - p[0]); // tallest first → drawn behind, shorter on top
      for (const [hh, col] of bands) {
        ctx2d.fillStyle = `rgba(${col},${alpha})`;
        place(Math.max(1, hh));
      }
      continue;
    }

    let color: string;
    if (dataless) {
      // Placeholder split by playhead like data columns (see below): the strip still
      // shows the playback position when nothing has decoded yet.
      color = played ? playedSolid : theme.unplayed;
    } else if (theme.mode === 'ramp' && theme.ramp) {
      // Traktor monochrome modes: colour by frequency position (dark = bass, bright = highs),
      // height still = amplitude. Weight mid/high so brighter reads as higher-frequency.
      const nl = bl * gLow;
      const nm = bm * gMid;
      const nh = bh * gHigh;
      const midWeighted = nm * 0.5;
      const total = nl + nm + nh + 1e-6;
      const pos = (midWeighted + nh) / total;
      const [rr, gg, bb2] = rampColor(theme.ramp, pos);
      color = played
        ? `rgb(${rr},${gg},${bb2})`
        : `rgba(${rr},${gg},${bb2},0.4)`;
    } else if (theme.mode === 'blue') {
      // Rekordbox Blue: cyan body brightening to white where high-frequency content
      // (transients) is strong — the classic monochrome-blue CDJ view.
      const total = bl + bm + bh + 1e-6;
      const hf = haveBands ? Math.min(1, (bh / total) * 1.8) : 0;
      const r = 40 + Math.round(215 * hf);
      const g = 180 + Math.round(75 * hf);
      color = played ? `rgb(${r},${g},255)` : `rgba(${r},${g},255,0.4)`;
    } else {
      color = played ? playedSolid : theme.unplayed;
    }

    const y = centered ? (cssHeight - barH) / 2 : cssHeight - barH;
    ctx2d.fillStyle = color;
    ctx2d.fillRect(x, y, barW, barH);
  }
};

/** Signature of everything visible the strip paints: while paused, repaint only on change. */
let lastPaintSig = '';
const paintSignature = (): string => {
  let filled = 0;
  for (let i = 0; i < RES; i++) filled += filledMask[i] + liveMask[i];
  // The effective grid duration: a metadata refinement (e.g. 100 s → 120 s) moves the
  // played marker and the accessible maximum even when playback is paused at the same
  // second, so it must repaint too.
  const gridDur = Math.round(trackDuration() || 0);
  return [
    // Millisecond precision: a paused seek can move the played boundary by several columns
    // within the same decisecond. Repaint only when the boundary actually moves otherwise.
    // (The ARIA value stays throttled to whole seconds.)
    Math.round(playbackPosition() * 1000),
    gridDur,
    filled,
    waveformRev,
    config.theme,
    config.barWidth,
    config.barGap,
    config.height,
    config.heightScale,
    config.background,
    config.shape,
    config.render,
    config.sensitivity,
    config.colorBalance,
    config.normalizeHeight,
    config.placeholderHeight,
    albumColor,
    canvas?.width,
    canvas?.height,
    // The player bar's top edge: a paused layout change (bar height) moves the overlay even
    // when the window size and bitmap inputs are unchanged, so it must trigger a repaint.
    Math.round(playerBar?.getBoundingClientRect().top ?? 0),
    window.innerWidth,
    window.innerHeight,
    window.devicePixelRatio,
  ].join('|');
};

const loop = () => {
  if (config.enabled) {
    // Track sync runs every frame (cheap); painting is skipped while paused and unchanged.
    syncTrack();
    if (video) {
      const nowMs = performance.now();
      const pos = playbackPosition();
      // Credit only continuously-advanced playback: a new baseline starts after any pause,
      // hidden-tab gap, or seek jump, so none of those contribute to the auto-fetch trigger.
      // (lastPlayTick == 0 is the first frame after a reset/track change.)
      const wallDt = lastPlayTick > 0 ? nowMs - lastPlayTick : 0;
      const posDt = pos - lastPlayPos;
      const continuous =
        !video.paused &&
        wallDt > 0 &&
        wallDt < 2000 &&
        posDt > 0 &&
        posDt <= Math.max(2, wallDt / 1000 + 1);
      if (continuous) playingMs += Math.min(wallDt, posDt * 1000);
      lastPlayTick = nowMs;
      lastPlayPos = pos;
    }
    if (ensureCanvas()) {
      // While paused the strip is static: skip the repaint unless something visible
      // changed (new data, setting/theme change, resize). Capture and live sampling
      // below keep running regardless.
      // Artwork needs no paint to discover a NEW URL: start its probe here so a paused
      // Album-theme frame still picks up a track change (the colour lands via albumColor,
      // which IS part of the signature, so the repaint then happens).
      if ((THEMES[config.theme] ?? THEMES.soundcloud).mode === 'album') {
        sampleAlbumColor();
      }
      const sig = paintSignature();
      if (!video?.paused || sig !== lastPaintSig) {
        lastPaintSig = sig;
        draw();
      }
      // HYBRID: progressive always runs so you get an instant waveform, even in full mode
      // while the fetch is in flight. When "Full waveform" is on, the whole-track fetch
      // runs in the BACKGROUND and, once decoded, replaces the partial strip with the
      // complete normalized one (progressive capture stops; live fill continues below).
      // If the fetch fails, progressive just keeps going — no empty/grey wait.
      if (config.fullWaveform) maybeFetchFull();
      else maybeAutoFallback();

      if (!fullDecoded) {
        tryDecodeRuns().catch(() => undefined);
      }
      // Live-fill the playhead bucket so playing through anything the decoder missed
      // still fills the waveform permanently — including buckets past a full decode's
      // coverage (a 99 s download on a 100 s grid leaves a tail that only live play
      // can complete, since progressive capture stops after a full install).
      sampleLivePlayhead();

      // Throttled state snapshot (~1/s) so the console shows continuous progress even
      // when nothing is decoding — track time, buffered ranges, filled coverage.
      const now = performance.now();
      if (video && now - lastStateLog > 1000) {
        lastStateLog = now;
        const dur = trackDuration();
        if (isFinite(dur) && dur > 0) {
          const snap = filledSpans();
          wfLog('tick', {
            tSec: Math.round(video.currentTime),
            ofSec: Math.round(dur),
            vDur: Math.round(video.duration), // raw video.duration, to spot refinement
            playing: !video.paused,
            buffered: bufferedRanges(video),
            filled: snap.pct,
            spans: snap.spans,
            runs: runs.length,
            mode: config.fullWaveform ? 'full' : 'progressive',
          });
        }
      }
    }
  } else if (canvas) {
    canvas.remove();
    canvas = null;
    ctx2d = null;
    backingW = backingH = 0;
    playerBar?.classList.remove('waveform-seekbar-active');
    playerBar = null;
  }
  rafId = requestAnimationFrame(loop);
};

const teardown = () => {
  if (rafId !== null) cancelAnimationFrame(rafId);
  rafId = null;
  canvas?.remove();
  canvas = null;
  ctx2d = null;
  backingW = backingH = 0;
  playerBar?.classList.remove('waveform-seekbar-active');
  playerBar = null;
};

export default createPlugin({
  name: () => 'Waveform Seekbar',
  description: () =>
    'Replaces the player-bar progress slider with a SoundCloud-style waveform, built ' +
    'progressively from the audio the player buffers — click to seek. Enable “Full waveform” ' +
    'to instead fetch the whole track once and draw a complete, stable strip up front.',
  // Enabling mid-track cannot capture the current track (its SourceBuffers predate our
  // wrappers, and its audio-can-play event already fired), so the strip would stay a
  // placeholder until the next track. Require a restart so enabling always starts clean.
  restartNeeded: true,
  config: defaultConfig,
  stylesheets: [style],

  // Only used by the opt-in full-waveform mode; the progressive default never calls it.
  backend: {
    start: backendStart,
    stop: backendStop,
  },

  menu: async ({ getConfig, setConfig, refresh }) => {
    const c = await getConfig();
    return [
      {
        label: 'Theme',
        // Grouped into sub-folders (Basic / Rekordbox / Traktor) so the growing theme list
        // stays navigable and each DJ-software family is together.
        submenu: THEME_GROUPS.map((group) => ({
          label: group,
          submenu: (Object.keys(THEMES) as WaveformTheme[])
            .filter((key) => THEMES[key].group === group)
            .map((key) => ({
              label: THEMES[key].label,
              type: 'radio' as const,
              checked: c.theme === key,
              // Switch render to the theme's native style (continuous for CDJ themes, bars for
              // Basic). Still overridable via the Render menu afterward. The menu is refreshed
              // (so the Render radio reflects the auto-change) but DEFERRED to the next tick —
              // calling it synchronously rebuilds the native menu mid-interaction and can leave a
              // sibling submenu rendered empty.
              click: () => {
                setConfig({ theme: key, render: preferredRender(key) });
                setTimeout(() => {
                  refresh();
                }, 150);
              },
            })),
        })),
      },
      {
        label: 'Bar height',
        submenu: [
          { label: 'Short', value: 0.5 },
          { label: 'Medium', value: 0.72 },
          { label: 'Tall', value: 0.9 },
          { label: 'Full', value: 1.1 },
        ].map((o) => ({
          label: o.label,
          type: 'radio' as const,
          checked: Math.abs(c.heightScale - o.value) < 0.001,
          click: () => {
            setConfig({ heightScale: o.value });
          },
        })),
      },
      {
        label: 'Peak sensitivity',
        submenu: [
          { label: 'Flat (0) — RMS body only', value: 0 },
          { label: 'Extra low (0.25×)', value: 0.25 },
          { label: 'Very low (0.4×)', value: 0.4 },
          { label: 'Low (0.6×)', value: 0.6 },
          { label: 'Medium (0.8×)', value: 0.8 },
          { label: 'Normal (1×) — natural peaks', value: 1 },
          { label: 'High (1.5×)', value: 1.5 },
          { label: 'Max (2.5×) — punchy', value: 2.5 },
        ].map((o) => ({
          label: o.label,
          type: 'radio' as const,
          checked: Math.abs((c.sensitivity ?? 1) - o.value) < 0.001,
          click: () => {
            setConfig({ sensitivity: o.value });
          },
        })),
      },
      {
        label: 'Color balance',
        submenu: [
          { label: 'Coolest (least red, 0.6×)', value: 0.6 },
          { label: 'Cool (less red, 0.8×)', value: 0.8 },
          { label: 'Neutral (1×)', value: 1 },
          { label: 'Warm (redder, 1.2×)', value: 1.2 },
          { label: 'Warmest (1.4×)', value: 1.4 },
        ].map((o) => ({
          label: o.label,
          type: 'radio' as const,
          checked: Math.abs((c.colorBalance ?? 1) - o.value) < 0.001,
          click: () => {
            setConfig({ colorBalance: o.value });
          },
        })),
      },
      {
        label: 'Strip height',
        submenu: [32, 40, 48, 64].map((h) => ({
          label: `${h}px`,
          type: 'radio' as const,
          checked: c.height === h,
          click: () => {
            setConfig({ height: h });
          },
        })),
      },
      {
        label: 'Bar width',
        submenu: [1, 2, 3, 4].map((w) => ({
          label: `${w}px`,
          type: 'radio' as const,
          checked: c.barWidth === w,
          click: () => {
            setConfig({ barWidth: w });
          },
        })),
      },
      {
        label: 'Background',
        submenu: [
          { label: 'Transparent', value: 'transparent' as const },
          { label: 'Player colour', value: 'player' as const },
        ].map((o) => ({
          label: o.label,
          type: 'radio' as const,
          checked: c.background === o.value,
          click: () => {
            setConfig({ background: o.value });
          },
        })),
      },
      {
        label: 'Shape',
        submenu: [
          { label: 'Centered', value: 'center' as const },
          { label: 'Bottom', value: 'bottom' as const },
        ].map((o) => ({
          label: o.label,
          type: 'radio' as const,
          checked: c.shape === o.value,
          click: () => {
            setConfig({ shape: o.value });
          },
        })),
      },
      {
        label: 'Render',
        submenu: [
          { label: 'Bars', value: 'bars' as const },
          { label: 'Continuous (Rekordbox)', value: 'filled' as const },
        ].map((o) => ({
          label: o.label,
          type: 'radio' as const,
          checked: c.render === o.value,
          click: () => {
            setConfig({ render: o.value });
          },
        })),
      },
      {
        label: 'Normalize height (fill the strip)',
        type: 'checkbox' as const,
        checked: c.normalizeHeight ?? true,
        toolTip:
          'Scale the height per track so the loudest section nears the full strip height — quiet ' +
          'material (live recordings) fills the strip instead of looking short. Off = fixed gain ' +
          '(true relative loudness).',
        // Read the checkbox's post-click state, not a stale config snapshot, so repeated toggles
        // alternate correctly even if the menu template hasn't been rebuilt.
        click: (item) => {
          setConfig({ normalizeHeight: item.checked });
        },
      },
      { type: 'separator' as const },
      {
        label: 'Full waveform',
        type: 'checkbox' as const,
        checked: c.fullWaveform,
        toolTip:
          'Show the waveform instantly from the buffer, AND fetch the whole track in the ' +
          'background to complete it — once ready every part is drawn (buffered or not) and ' +
          'seeking never moves the bars. Off = progressive only (no extra download, but ' +
          'can’t show parts you haven’t reached). Does not require the Downloader plugin.',
        click: (item) => {
          setConfig({ fullWaveform: item.checked });
        },
      },
      {
        label: 'Max full-fetch length',
        toolTip:
          'Tracks longer than this skip the whole-track download and use the progressive path, ' +
          'so a multi-hour live set or DJ mix isn’t pulled over the network. “Unlimited” removes ' +
          'only this length cap — very long tracks can still stay progressive under the decoder’s ' +
          'memory ceiling (DevTools logs the reason when that happens).',
        submenu: [
          { label: '20 min', value: 20 },
          { label: '30 min', value: 30 },
          { label: '45 min', value: 45 },
          { label: '60 min', value: 60 },
          { label: '120 min', value: 120 },
          { label: 'Unlimited', value: 0 },
        ].map((o) => ({
          label: o.label,
          type: 'radio' as const,
          checked: (c.maxFullMinutes ?? 30) === o.value,
          click: () => {
            setConfig({ maxFullMinutes: o.value });
          },
        })),
      },
      {
        label: 'Auto-fetch when a track can’t be read (progressive mode)',
        type: 'checkbox' as const,
        checked: c.autoFullFallback,
        toolTip:
          'Opt-in; only used when “Full waveform” is off. If a track plays a few seconds with ' +
          'almost nothing decoded (resumed/cached track the plugin missed), download it once so ' +
          'the waveform isn’t left grey. Off (default) = progressive mode never downloads a ' +
          'whole track.',
        click: (item) => {
          setConfig({ autoFullFallback: item.checked });
        },
      },
    ];
  },

  renderer: {
    start() {
      captureActive = true;
      hookMse();
    },

    async onPlayerApiReady(api, { getConfig, ipc }) {
      config = await getConfig();
      ipcRenderer = ipc;
      playerApi = api;
      hookMse();
      video = document.querySelector<HTMLVideoElement>('video');

      audioCanPlayListener = (e: Event) =>
        attachAnalyser((e as CustomEvent<Compressor>).detail);
      document.addEventListener('peard:audio-can-play', audioCanPlayListener, {
        passive: true,
      });

      // On seek, start a fresh run seeded with the init segment so the post-seek audio
      // (non-contiguous with the start) decodes on its own and lands at the seek point.
      seekingListener = () => {
        if (!video) return;
        // Ignore seeks fired during a track transition (duration NaN/0, no buffer) — they
        // would create a bogus run at time 0 for the wrong track.
        const dur = trackDuration();
        if (!isFinite(dur) || dur <= 0) return;
        pendingSeekTime = playbackPosition();
        const target = pendingSeekTime;
        // If the seek lands inside buffered media that is continuous with the current run's
        // decoded coverage, the player keeps appending from the buffer end — starting a
        // fresh run would misplace those bytes at the seek point. Keep the run when the
        // range overlaps or abuts it on BOTH sides (its end reaches the run start and its
        // start stays within the covered end); a real discontinuity announces itself with
        // a fresh init, which routeChunk turns into a new run.
        if (currentRun && currentRun.start !== undefined) {
          const EPS = 0.05; // float tolerance for boundary comparisons (sub-bucket)
          try {
            const coveredEnd =
              currentRun.start + (currentRun.decodedSec ?? 0);
            const { buffered } = video;
            for (let i = 0; i < buffered.length; i++) {
              if (
                target >= buffered.start(i) &&
                target <= buffered.end(i) &&
                buffered.start(i) <= coveredEnd + EPS &&
                buffered.end(i) >= currentRun.start - EPS
              ) {
                wfLog('SEEK (continuous buffer — keeping run)', {
                  toSec: Math.round(target),
                });
                return;
              }
            }
          } catch {
            /* buffered can throw if not ready — fall through to a fresh run */
          }
        }
        // The run we're leaving becomes sealed. If it already finished decoding, nothing
        // will decode it again (the selector only picks runs with undecoded bytes), so free
        // its chunks now instead of retaining them until eviction — repeated seeks would
        // otherwise hold ~MAX_RUNS cap-sized buffers. Never while it has in-flight appends.
        if (
          currentRun &&
          isFullyDecoded(currentRun) &&
          (pendingByRun.get(currentRun) ?? 0) === 0
        ) {
          currentRun.chunks = [];
        }
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        if (initSegment) {
          chunks.push(initSegment);
          bytes = initSegment.length;
        }
        currentRun = {
          seekTarget: pendingSeekTime,
          chunks,
          bytes,
          lastDecodedBytes: 0,
          evidence: snapshotBufferedRanges(),
        };
        runs.push(currentRun);
        if (runs.length > MAX_RUNS) evictOldestRun();
        const snap = filledSpans();
        wfLog('SEEK', {
          toSec: Math.round(pendingSeekTime),
          ofSec: Math.round(dur),
          progress: Math.round((pendingSeekTime / (dur || 1)) * 100) + '%',
          buffered: bufferedRanges(video),
          hasInit: !!initSegment,
          runsNow: runs.length,
          filled: snap.pct,
          spans: snap.spans,
        });
      };
      video?.addEventListener('seeking', seekingListener);

      wfLog('START', { build: WF_BUILD, fullWaveform: config.fullWaveform });
      loop();
    },

    onConfigChange(newConfig: WaveformProgressConfig) {
      const previous = config;
      config = newConfig;
      // Turning a download option on, or raising the length cap, is an explicit request to try
      // again for the track that is playing: forget that it was already attempted (or skipped
      // for its length) so the next frame fetches it and the complete waveform replaces the
      // progressive one. Without this a track that was tried once stayed progressive until the
      // next track, even after toggling Full waveform off and on.
      const wantsMore =
        (newConfig.fullWaveform && !previous.fullWaveform) ||
        (newConfig.autoFullFallback && !previous.autoFullFallback) ||
        newConfig.maxFullMinutes !== previous.maxFullMinutes;
      if (wantsMore && !fullDecoded) {
        fullFetchKey = '';
        fullFetchGen = -1;
      }
    },

    stop() {
      teardown();
      // Stop capturing and drop everything captured so far. Without this the append hook kept
      // copying audio into `runs` after the plugin was disabled (up to MAX_RUNS × MAX_RUN_BYTES),
      // and a decode or fetch still in flight could write into the timeline afterwards.
      captureActive = false;
      resetForNewTrack(); // clears runs/init segment/timeline and bumps trackGen to cancel in-flight work
      trackKey = ''; // a re-enable re-syncs the track from scratch
      decoding = false;
      decodeRun = null;
      decodeAttempt++;
      slowDecodeWaits = 0;
      if (audioCanPlayListener) {
        document.removeEventListener(
          'peard:audio-can-play',
          audioCanPlayListener,
        );
        audioCanPlayListener = null;
      }
      if (video && seekingListener) {
        video.removeEventListener('seeking', seekingListener);
        seekingListener = null;
      }
      ipcRenderer = null;
      playerApi = null;
      fullDecoded = false;
      fullFetchKey = '';
      fullFetchGen = -1;
      fullFetching = false;
    playingMs = 0;
    lastPlayTick = 0;
    lastPlayPos = -1;
    // Disconnect only OUR analyser tap (the shared context and the player's other
    // connections stay untouched), then drop our references so a re-enable starts clean
    // and the stopped plugin holds nothing from the player's audio graph.
    try {
      if (audioSourceNode && analyser) audioSourceNode.disconnect(analyser);
    } catch {
      /* already disconnected */
    }
    analyser = null;
    audioSourceNode = null;
    audioContext = null;
    timeData = null;
    liveFloat = null;
    lastLiveBucket = -1;
    peakScale = DECODE_GAIN;
      try {
        if (decodeContext) decodeContext.close().catch(() => undefined);
      } catch {
        /* ignore */
      }
      decodeContext = null;
    },
  },
});
