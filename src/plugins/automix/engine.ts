import SignalsmithStretch, { type StretchNode } from 'signalsmith-stretch';

import { emptySection, type TrackAnalysis } from './analysis';
import { alignApple, withApple } from './apple-analysis';
import {
  decodeAndAnalyze,
  decodeWindow,
  LOUDNESS_HOP,
  type AnalyzedTrack,
} from './decoder';
import {
  CROSSFADE_REVERB,
  EFFECT_DEFAULTS,
  effectById,
  withBassSwap,
  effectName,
  scheduleLanes,
  timeIn,
  type EffectParam,
  type EffectStyle,
} from './effects';
import { bassSwapWindow } from './bass';
import { alignKicks } from './kicks';
import { planTransition, type TransitionPlan } from './planner';
import { getQueueStore, largeArt, readQueue, type QueueTrack } from './queue';
import {
  loadSummaries,
  saveSummaries,
  summarize,
  type TrackSummary,
} from './reorder';
import { locateCapture } from './sync';

import type { AutoMixPluginConfig } from './config';
import type { AppleAnalysis, AppleLookup, FetchedAudio } from './constants';
import type { MusicPlayer } from '@/types/music-player';

export type AutoMixPhase =
  | 'inactive'
  | 'waiting'
  | 'analyzing'
  | 'ready'
  | 'mixing';

/** Why AutoMix won't mix the current song into the next one */
export type AutoMixWaitReason =
  | 'no-next'
  | 'repeat-one'
  | 'same-album'
  | 'analysis-failed'
  | 'version-mismatch'
  | 'no-room';

export interface AutoMixStatus {
  phase: AutoMixPhase;
  reason?: AutoMixWaitReason;
  plan?: TransitionPlan;
  fromTitle?: string;
  toTitle?: string;
  /** Artwork of both songs, to cross-fade the player's image while mixing */
  fromArt?: string;
  toArt?: string;
  /** 0..1 progress of the audible blend (mixing only) */
  progress?: number;
  /** Stream quality of AutoMix's copy, when it's noticeably worse */
  lowQuality?: string;
}

/** One song's waveform on the transition's timeline, split into bands */
export interface TimelineLane {
  /** Timeline time (outgoing song seconds) of the first column */
  start: number;
  /** Timeline seconds per column */
  step: number;
  /** Level per column, 0..1, of the bass (< 200 Hz), mids and highs (> 2.5 kHz) */
  low: Float32Array;
  mid: Float32Array;
  high: Float32Array;
}

/**
 * The planned transition, laid out for drawing: both songs on one timeline
 * in the outgoing song's seconds (the incoming song mapped onto it through
 * the plan's entry point and tempo ratio)
 */
export interface TransitionTimeline {
  plan: TransitionPlan;
  fromTitle?: string;
  toTitle?: string;
  fromArt?: string;
  toArt?: string;
  /** The stretch of the timeline worth showing */
  start: number;
  end: number;
  out: TimelineLane;
  in: TimelineLane | null;
  /** Downbeats of each song, on the timeline */
  outBars: number[];
  inBars: number[];
  /** Where the basslines swap, on the timeline (blends) */
  bassSwap?: [number, number];
  /** Where the next song's first vocal line lands, on the timeline */
  vocal?: number;
}

/** Seconds of the songs shown either side of the transition */
const TIMELINE_MARGIN = 14;
/** Timeline columns per second */
const TIMELINE_RATE = 25;

/**
 * Band levels of `buffer` (whose first sample is song time `bufferStart`)
 * from song time `from` on, `count` columns of `step` song seconds each
 */
const bandLevels = (
  buffer: AudioBuffer,
  bufferStart: number,
  from: number,
  step: number,
  count: number,
) => {
  const { sampleRate } = buffer;
  const low = new Float32Array(count);
  const mid = new Float32Array(count);
  const high = new Float32Array(count);
  const sums = [new Float64Array(count), new Float64Array(count), new Float64Array(count)];
  const counts = new Uint32Array(count);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) =>
    buffer.getChannelData(c),
  );
  const pole = (hz: number) => Math.exp((-2 * Math.PI * hz) / sampleRate);
  const p200 = pole(200);
  const p2500 = pole(2500);
  // Settle the filters a little before the first column
  const first = Math.max(0, Math.floor((from - bufferStart - 0.1) * sampleRate));
  const last = Math.min(
    buffer.length,
    Math.ceil((from + (step * count) - bufferStart) * sampleRate),
  );
  let a = 0;
  let b = 0;
  for (let i = first; i < last; i++) {
    let x = 0;
    for (const channel of channels) x += channel[i];
    x /= channels.length;
    a = (p200 * a) + ((1 - p200) * x);
    b = (p2500 * b) + ((1 - p2500) * x);
    const column = Math.floor(((bufferStart + (i / sampleRate)) - from) / step);
    if (column < 0 || column >= count) continue;
    sums[0][column] += a * a;
    sums[1][column] += (b - a) * (b - a);
    sums[2][column] += (x - b) * (x - b);
    counts[column]++;
  }
  const level = (sum: number, n: number) =>
    n ? clamp(((10 * Math.log10((sum / n) + 1e-12)) + 54) / 54, 0, 1) : 0;
  for (let k = 0; k < count; k++) {
    low[k] = level(sums[0][k], counts[k]);
    mid[k] = level(sums[1][k], counts[k]);
    high[k] = level(sums[2][k], counts[k]);
  }
  return { low, mid, high };
};

interface EngineOptions {
  api: MusicPlayer;
  fetchAudio: (videoId: string) => Promise<FetchedAudio | null>;
  fetchApple: (lookup: AppleLookup) => Promise<AppleAnalysis | null>;
  onStatus: (status: AutoMixStatus) => void;
}

interface OutgoingChain {
  source: AudioBufferSourceNode;
  /** The plain copy's level into `input` (a stretched copy can take over) */
  sourceGain: GainNode;
  /** Where the copy enters the filters */
  input: GainNode;
  dry: GainNode;
  master: GainNode;
  highpass?: BiquadFilterNode;
  lowShelf?: BiquadFilterNode;
  lowpass?: BiquadFilterNode;
  /** Last node before the dry gain (where an echo send taps in) */
  tap: AudioNode;
  /** What an effect style's lanes automate, when the blend has one */
  fx?: Partial<Record<EffectParam, AudioParam>>;
  /** A beat repeater's way in: the song's level, and where loops go */
  repeat?: { song: GainNode; into: AudioNode; loops: AudioBufferSourceNode[] };
  nodes: AudioNode[];
  /**
   * Connections out of nodes shared between mixes (the stretchers): only
   * these are undone on teardown, a newer mix may use the node already
   */
  shared: [AudioNode, AudioNode][];
}

/** AutoMix's own sample-accurate copy of the incoming song's start */
interface IncomingHead {
  source: AudioBufferSourceNode | StretchNode;
  gain: GainNode;
  master: GainNode;
  masterTarget: number;
  /** Context time at which the copy runs out */
  endAt: number;
  /** Earliest context time the player may take over */
  handOverFrom: number;
  /** Where the copy is in the song at a context time */
  position: (time: number) => number;
  /** The copy's playback rate at a context time */
  rate: (time: number) => number;
  /** The node `source` feeds (to undo just that from a shared stretcher) */
  entry: AudioNode;
  /** Sends a stretched copy its next tempo change when it's due */
  advance?: (now: number) => void;
  /** The incoming song's start, as decoded (song time = buffer time) */
  buffer: AudioBuffer;
}

/** Where the outgoing copy is in its song, and how fast, at a context time */
interface OutgoingClock {
  position: (time: number) => number;
  rate: (time: number) => number;
  /** Seconds per beat of the outgoing song, at its own tempo */
  beat: number;
  /** Song time of the copy's first sample */
  tailStart: number;
}

/** A stretched copy's playback rate from a context time on */
interface RateStep {
  at: number;
  rate: number;
}

interface ActiveMix {
  plan: TransitionPlan;
  fromId: string;
  toId: string;
  fromTitle: string;
  toTitle: string;
  fromArt?: string;
  toArt?: string;
  chain: OutgoingChain;
  /** Context time at which our copy of the outgoing track took over */
  startAt: number;
  /** Context time at which the outgoing track reaches plan.mixOut */
  mixAt: number;
  /** Context time at which the outgoing track is gone */
  endAt: number;
  switched: boolean;
  /** The beat cut has dropped the incoming song in */
  cutDone: boolean;
  /** Set when the incoming side is played from our own copy */
  head?: IncomingHead;
  /** Stretcher playing the outgoing copy, when a blend splits the stretch */
  outStretch?: StretchNode;
  /** Sends the outgoing stretcher its next tempo change when it's due */
  outAdvance?: (now: number) => void;
  /** The old song's tempo (rate) at a context time, for the debug log */
  outRate?: (time: number) => number;
  /** Where the old song is (its seconds) at a context time */
  outPosition: (time: number) => number;
  /**
   * The player's own audio, inverted: while it's on, whatever the player
   * plays is cancelled out exactly, so muting or unmuting the element can
   * land whenever it likes without being heard
   */
  cancel?: GainNode;
  /** Consecutive ticks the player has been in sync with our copy */
  lockedTicks: number;
  /** The player's audio was last heard right on our copy's */
  heardInSync: boolean;
  /** How far off it was heard last, in seconds (positive: ahead) */
  heardError?: number;
  /** The player's audio has been heard clearly: it steers the hand-over */
  earWorks: boolean;
  /** Seeks made to put the player on our copy by ear */
  earSeeks: number;
  /** Context time from which the player's audio is worth listening to */
  hearAfter: number;
  /** The player has been on the incoming song at least once */
  sawIncoming: boolean;
  /** Bars the blend was pushed back waiting for the next song to sync */
  deferrals: number;
  /** Track time at which our copy of the outgoing song runs out */
  outgoingEnd: number;
  /** Follow the beat grid (false once we fell back to a plain fade) */
  follow: boolean;
  seeded: boolean;
  pendingSeeks: number;
  error: number;
  /** Element volume YouTube Music wants (user volume × normalisation) */
  baseVolume: number;
  /** How loud the player itself should be, 0..1 of baseVolume */
  level: number;
  handoffVolume: number;
  handoffSliderVolume: number;
  masterTarget: number;
  lastRate: number;
  rateFights: number;
  rateLocked: boolean;
  settleFrom?: number;
  settleAt?: number;
  timers: number[];
}

/** Player controls that seek or change the song; touching one cancels a mix */
const SEEK_AND_SKIP_CONTROLS = [
  'ytmusic-player-bar #progress-bar',
  'ytmusic-player-bar .next-button',
  'ytmusic-player-bar .previous-button',
  'ytmusic-player-queue-item',
  'ytmusic-play-button-renderer',
].join(', ');

/** The player's seek / next / previous keyboard shortcuts */
const SEEK_AND_SKIP_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'j',
  'l',
  'J',
  'L',
  'N',
  'P',
]);

const IDLE_TICK_MS = 250;
const FAST_TICK_MS = 20;
const QUEUE_REFRESH_MS = 2000;
/** How far the player's real position may be from its reported one */
const SYNC_SEARCH_SECONDS = 0.35;
/** Correlation needed to trust a position match */
const SYNC_MIN_SCORE = 0.6;
/**
 * Behind our copy, the player hands over once it's heard this close to it.
 * Nudging its speed can't get it there: every playbackRate change makes
 * Chrome's audio jump ~25 ms (and currentTime only roughly follows), so it's
 * put in place by ear, with seeks
 */
const HEARD_SYNC = 0.003;
/** Good enough after a few seeks that kept landing just off */
const HEARD_SYNC_LOOSE = 0.008;
const EAR_SEEKS = 3;
/** How much of the player's latest audio a check listens to */
const HEAR_SECONDS = 0.25;
/** How far from where it should be a check looks for the player */
const HEAR_SEARCH = 0.08;
/** Checks at most this often */
const HEAR_EVERY = 0.1;
/** How long the player gets to be heard before currentTime is trusted */
const EAR_GRACE = 1.5;
/** Most bars a blend waits for a late-loading next song */
const MAX_DEFERRALS = 2;
/** A song-length mismatch has to last this long to count (seeks re-buffer) */
const MISMATCH_GRACE_MS = 3000;
const RETRY_FAILED_MS = 120_000;
/** Media seek takes a moment before audio resumes */
const SEEK_LATENCY = 0.08;
/** Tempo glide back to normal after a blend: slow, so it isn't heard */
const SETTLE_SECONDS = 14;
/** Same glide for a stretched copy of the incoming song, in steps */
const GLIDE_SECONDS = 8;
const GLIDE_STEP = 0.5;
/** The outgoing song's glide to the shared tempo, before the mix point */
const OUT_GLIDE_SECONDS = 2;
/** When the stretched outgoing copy takes over from the plain one */
const OUT_HANDOFF = 0.5;
/**
 * How far ahead our copy of the outgoing song is scheduled to take over.
 * Setting the mix up takes the main thread ~100 ms; a start time already in
 * the past would start the copy late, repeating what the player just played
 */
const START_LEAD = 0.25;
/** Step of the shared tempo glide during a blend */
const BLEND_GLIDE_STEP = 0.25;
const CROSSOVER_HZ = 180;
const SILENT_VOLUME = 0.0001;
/** Log wanted vs actual levels 5x a second while mixing (opt in) */
const DEBUG_KEY = 'automix-debug';

/** The element's own volume, past the override AutoMix puts on it */
const volumeProperty = Object.getOwnPropertyDescriptor(
  HTMLMediaElement.prototype,
  'volume',
)!;
const realVolume = (video: HTMLMediaElement) =>
  volumeProperty.get!.call(video) as number;
const setRealVolume = (video: HTMLMediaElement, volume: number) =>
  volumeProperty.set!.call(video, volume);
/** How long the final hit of a song that stops on the beat rings out */
const ENDING_RING = 1.5;
/** Where the incoming song's high-pass starts when it's filtered in */
const FILTER_IN_HZ = 500;
/** Start a no-analysis fade plan this long before the song's audible end */
const LATE_PLAN_SECONDS = 25;
/** How much of the playing song a mix-now decodes from where it is */
const MIX_NOW_SECONDS = 60;
/** Seconds a mix-now needs at least to set its transition up */
const MIX_NOW_LEAD = 6.5;

/** Stand-in for a next song we couldn't analyse in time: fade into its start */
const unknownTrack: TrackAnalysis = {
  duration: Number.POSITIVE_INFINITY,
  bpm: 0,
  beatPeriod: 0,
  tempoConfidence: 0,
  beats: [],
  downbeats: [],
  leadingSilenceEnd: 0,
  trailingSilenceStart: Number.POSITIVE_INFINITY,
  introEnd: 0,
  outroStart: Number.POSITIVE_INFINITY,
  decayPoint: Number.POSITIVE_INFINITY,
  bodyLoudness: -20,
  start: emptySection,
  end: emptySection,
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/**
 * When a blend swaps the basslines over: the outgoing bass goes out as the
 * incoming bass comes in, so two basslines never play at once
 */
/**
 * The incoming song's tempo through a blend when both songs glide, like
 * Apple Music's AutoMix: it comes in at the old song's tempo (`rate`) and
 * reaches its own (1x) as the blend ends, while the old song moves the
 * other way at rate / `rate`. Both share one tempo at every step, so the
 * beats stay locked, and neither changes speed while it plays alone.
 */
const blendGlide = (from: number, to: number, rate: number): RateStep[] => {
  const count = Math.max(1, Math.round((to - from) / BLEND_GLIDE_STEP));
  const step = (to - from) / count;
  const steps: RateStep[] = [];
  for (let k = 0; k < count; k++) {
    const x = (k + 0.5) / count;
    steps.push({ at: from + (k * step), rate: rate ** (1 - x) });
  }
  steps.push({ at: to, rate: 1 });
  return steps;
};

const bassSwap = (plan: TransitionPlan, mixAt: number) => {
  if (plan.holdOutgoing) {
    // On the old song's final hit
    const hit = mixAt + plan.duration;
    return { from: hit - ((plan.beat || 0.5) / 2), to: hit };
  }
  const [from, to] = plan.bassSwapAt ?? [0.45, 0.55];
  return {
    from: mixAt + (plan.duration * from),
    to: mixAt + (plan.duration * to),
  };
};

/** When a filtered-in incoming song has fully opened up, after the mix */
const filterOpenBy = (plan: TransitionPlan) =>
  plan.holdOutgoing ? plan.duration : plan.duration * 0.7;

/** Time between taking over the outgoing track and the audible mix */
export const prerollFor = (plan: TransitionPlan) =>
  clamp((plan.beat * 4) + 0.5, 4, 6);

const equalPowerIn = (() => {
  const curve = new Float32Array(64);
  for (let i = 0; i < curve.length; i++) {
    curve[i] = Math.sin(((i / (curve.length - 1)) * Math.PI) / 2);
  }
  return curve;
})();

const equalPowerOut = (() => {
  const curve = new Float32Array(64);
  for (let i = 0; i < curve.length; i++) {
    curve[i] = Math.cos(((i / (curve.length - 1)) * Math.PI) / 2);
  }
  return curve;
})();

/**
 * A plain reverb's impulse: decaying stereo noise, falling 60 dB over
 * `decay` seconds (Apple's reverb decay times), brighter at the start
 */
const reverbImpulse = (context: AudioContext, decay: number) => {
  const length = Math.round(Math.min(decay, 6) * context.sampleRate);
  const impulse = context.createBuffer(2, length, context.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = impulse.getChannelData(c);
    let smooth = 0;
    for (let i = 0; i < length; i++) {
      const t = i / context.sampleRate;
      // The tail darkens as it dies away
      const darken = Math.min(0.95, t / decay);
      smooth = (smooth * darken) + (((Math.random() * 2) - 1) * (1 - darken));
      data[i] = smooth * Math.exp((-6.9 * t) / decay) * 0.5;
    }
  }
  return impulse;
};

export class AutoMixEngine {
  private readonly api: MusicPlayer;
  private readonly fetchAudio: EngineOptions['fetchAudio'];
  private readonly fetchApple: EngineOptions['fetchApple'];
  private readonly onStatus: EngineOptions['onStatus'];

  private config: AutoMixPluginConfig;
  private context: AudioContext | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  /** Taps what the player actually plays, to measure its true position */
  private tap: AnalyserNode | null = null;
  /**
   * What the player is really playing minus what its currentTime says, in
   * seconds; measured from the audio itself at each hand-off
   */
  private playerOffset = 0;

  /** Time-stretch our copies of the incoming / outgoing song (reused) */
  private stretch: StretchNode | null = null;
  private stretchOut: StretchNode | null = null;
  private stretchContext: AudioContext | null = null;
  /** Song pair (from>to) that couldn't split its stretch: plan it without */
  private noSplitFor = '';

  private readonly tracks = new Map<string, Promise<AnalyzedTrack | null>>();
  private readonly ready = new Map<string, AnalyzedTrack>();
  /**
   * Tempo / key summaries for reordering the queue, by video id, most
   * recently used last. Saved between sessions
   */
  private readonly summaries = loadSummaries();
  private readonly failedAt = new Map<string, number>();
  /** Title / artist of the songs around the playing one, to look them up on Apple Music */
  private readonly songInfo = new Map<string, { title: string; artist: string }>();

  private currentId: string | null = null;
  /**
   * Mix now, asked for on this song: `track` is the song from where it was
   * asked on (null while that's being decoded)
   */
  private rush: { videoId: string; track: AnalyzedTrack | null } | null =
    null;
  private next: QueueTrack | null = null;
  private afterNext: QueueTrack | null = null;
  private queueStore: ReturnType<typeof getQueueStore> = undefined;
  private unsubscribeQueue: (() => void) | null = null;
  private currentTitle = '';
  private currentArt: string | undefined;
  private repeatOne = false;
  private sameAlbum = false;
  private lastQueueRead = 0;

  private plan: TransitionPlan | null = null;
  private planKey = '';
  private mix: ActiveMix | null = null;

  private timer: number | undefined;
  private stopped = false;
  private lastDebug = 0;
  /** Song pair (from>to) whose audio was last brought back into memory */
  private warmedFor = '';
  /** A transition starts within the next few seconds */
  private mixSoon = false;
  /** Read results, so warming up buffers isn't optimised away */
  private warmSink = 0;
  private lastStatus = '';

  constructor(options: EngineOptions, config: AutoMixPluginConfig) {
    this.api = options.api;
    this.fetchAudio = options.fetchAudio;
    this.fetchApple = options.fetchApple;
    this.onStatus = options.onStatus;
    this.config = config;

    document.addEventListener('peard:audio-can-play', this.onAudioCanPlay, {
      passive: true,
    });
    const video = this.video;
    video?.addEventListener('seeking', this.onSeeking);
    video?.addEventListener('pause', this.onPause);
    document.addEventListener('pointerdown', this.onUserInput, true);
    document.addEventListener('keydown', this.onUserInput, true);

    this.schedule(0);
  }

  setConfig(config: AutoMixPluginConfig) {
    if (config.appleAnalysis !== this.config.appleAnalysis && !this.mix) {
      // Analyse the songs again with (or without) Apple Music's analysis
      this.tracks.clear();
      this.ready.clear();
    }
    this.config = config;
    if (!config.active && this.mix) this.abort();
    this.planKey = '';
    this.schedule(0);
  }

  /** The player creates its AudioContext before plugins are told about it */
  setAudioContext(context: AudioContext) {
    this.context = context;
    this.ensureStretch();
  }

  destroy() {
    this.stopped = true;
    if (this.mix) this.abort();
    window.clearTimeout(this.timer);
    document.removeEventListener('peard:audio-can-play', this.onAudioCanPlay);
    this.tap?.disconnect();
    this.tap = null;
    this.stretch?.disconnect();
    this.stretch = null;
    this.stretchOut?.disconnect();
    this.stretchOut = null;
    this.stretchContext = null;
    const video = this.video;
    video?.removeEventListener('seeking', this.onSeeking);
    video?.removeEventListener('pause', this.onPause);
    document.removeEventListener('pointerdown', this.onUserInput, true);
    document.removeEventListener('keydown', this.onUserInput, true);
    this.unsubscribeQueue?.();
    this.unsubscribeQueue = null;
    this.tracks.clear();
    this.ready.clear();
  }

  /* ------------------------------------------------------------------ */
  /* Plumbing                                                            */
  /* ------------------------------------------------------------------ */

  private get video() {
    return document.querySelector<HTMLVideoElement>('video');
  }

  private readonly onAudioCanPlay = (event: CustomEvent<Compressor>) => {
    this.context = event.detail.audioContext;
    if (this.source !== event.detail.audioSource) {
      this.tap?.disconnect();
      this.tap = null;
      this.source = event.detail.audioSource;
    }
    this.ensureTap();
    this.ensureStretch();
  };

  private ensureStretch() {
    const context = this.context;
    if (!context || this.stretchContext === context) return;
    this.stretchContext = context;
    this.stretch = null;
    this.stretchOut = null;
    // Without them, the player stretches the incoming song itself (rougher)
    // and the outgoing one isn't stretched at all
    Promise.all([SignalsmithStretch(context), SignalsmithStretch(context)])
      .then(([incoming, outgoing]) => {
        if (this.stretchContext === context && !this.stopped) {
          this.stretch = incoming;
          this.stretchOut = outgoing;
        }
      })
      .catch(() => {});
  }

  /** Both songs of a blend can be stretched half way each */
  private canSplit() {
    return Boolean(this.stretch && this.stretchOut);
  }

  /** The tempo gap a blend can bridge with each song within `maxStretch` */
  stretchRange(maxStretch: number) {
    return this.canSplit() ? ((1 + maxStretch) ** 2) - 1 : maxStretch;
  }

  private ensureTap() {
    if (this.tap || !this.context || !this.source) return;
    const tap = this.context.createAnalyser();
    tap.fftSize = 32768;
    this.source.connect(tap);
    this.tap = tap;
  }

  /**
   * Measures where the player really is: matches the last ~0.7 s it played
   * against our copy of the song. Keeps the previous value if the audio is
   * too quiet or ambiguous to match.
   */
  /**
   * Returns where the player's audio is in the song at a context time,
   * read from the audio itself, so it holds however long this takes and
   * however stale the player's currentTime is
   */
  private measurePlayerOffset(video: HTMLVideoElement, track: AnalyzedTrack) {
    const tap = this.tap;
    const context = this.context;
    if (!tap || !context) return null;
    const capture = new Float32Array(tap.fftSize);
    tap.getFloatTimeDomainData(capture);
    const capturedAt = context.currentTime;
    const reported = this.songTime(video);

    const span = capture.length / track.tail.sampleRate;
    const expected = reported + this.playerOffset - span - track.tailStart;
    const found = locateCapture(
      capture,
      track.tail,
      expected - SYNC_SEARCH_SECONDS,
      expected + SYNC_SEARCH_SECONDS,
    );
    if (!found || found.score < SYNC_MIN_SCORE) return null;

    const position = track.tailStart + found.time + span;
    const offset = position - reported;
    if (Math.abs(offset) > SYNC_SEARCH_SECONDS) return null;
    this.playerOffset = offset;
    return { position, at: capturedAt };
  }

  /**
   * How far the element's clock runs ahead of the song. When a song ends on
   * its own, YouTube Music plays the next one gaplessly on the same media
   * timeline, so currentTime keeps counting from where the last song ended
   */
  private timelineOffset(video: HTMLVideoElement) {
    try {
      const offset = video.currentTime - this.api.getCurrentTime();
      if (Number.isFinite(offset) && offset > 0.5) return offset;
    } catch {
      // Treat as a plain timeline
    }
    return 0;
  }

  /** Where the player is in the song (its reported position) */
  private songTime(video: HTMLVideoElement) {
    return video.currentTime - this.timelineOffset(video);
  }

  /**
   * How far the player's audio is from our copy of the incoming song, read
   * from the audio itself (positive: the player is ahead). Null when it
   * can't be made out clearly enough
   */
  private hearIncoming(head: IncomingHead) {
    const tap = this.tap;
    const context = this.context;
    if (!tap || !context) return null;
    const all = new Float32Array(tap.fftSize);
    tap.getFloatTimeDomainData(all);
    const heardAt = context.currentTime;
    const capture = all.subarray(
      all.length - Math.round(HEAR_SECONDS * head.buffer.sampleRate),
    );
    const expected =
      head.position(heardAt) - (capture.length / head.buffer.sampleRate);
    const found = locateCapture(
      capture,
      head.buffer,
      expected - HEAR_SEARCH,
      expected + HEAR_SEARCH,
    );
    if (!found || found.score < SYNC_MIN_SCORE) return null;
    return found.time - expected;
  }

  /**
   * Puts the silent player exactly on our copy once that plays at the song's
   * own speed: listens where it really is, and seeks it by what's off.
   * False when it can't be heard (the caller follows currentTime instead)
   */
  private followByEar(
    mix: ActiveMix,
    head: IncomingHead,
    video: HTMLVideoElement,
    now: number,
    rate: number,
  ) {
    // No more nudging: every change would move it again
    this.setRate(rate);
    if (now < mix.hearAfter) return mix.earWorks;
    mix.hearAfter = now + HEAR_EVERY;
    const error = this.hearIncoming(head);
    if (error === null) return mix.earWorks;
    mix.earWorks = true;
    mix.heardError = error;
    const tolerance = mix.earSeeks >= EAR_SEEKS ? HEARD_SYNC_LOOSE : HEARD_SYNC;
    mix.heardInSync = Math.abs(error) < tolerance;
    if (!mix.heardInSync) {
      mix.earSeeks++;
      this.seekIncoming(this.songTime(video) - error);
      // Only what it plays after the seek tells where it landed
      mix.hearAfter = now + HEAR_SECONDS + 0.15;
    }
    return true;
  }

  private schedule(delay: number) {
    if (this.stopped) return;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.tick(), delay);
  }

  /** Runs `callback` as close as possible to context time `time` */
  private at(time: number, callback: () => void) {
    if (!this.context || !this.mix) return;
    const delay = Math.max(0, (time - this.context.currentTime) * 1000);
    this.mix.timers.push(window.setTimeout(callback, delay));
  }

  private emit(status: AutoMixStatus) {
    const key = JSON.stringify({
      ...status,
      progress:
        status.progress === undefined
          ? undefined
          : Math.round(status.progress * 100),
    });
    if (key === this.lastStatus) return;
    this.lastStatus = key;

    this.onStatus(status);
  }

  private currentVideoId() {
    try {
      return this.api.getVideoData()?.video_id ?? null;
    } catch {
      return null;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Analysis cache                                                      */
  /* ------------------------------------------------------------------ */

  /**
   * Tempo / key summary of a song, for reordering the queue. Analyses the
   * song if AutoMix hasn't yet, keeping only the summary (not the audio)
   */
  async summaryOf({
    videoId,
    title,
    artist,
  }: QueueTrack): Promise<TrackSummary | null> {
    const cached = this.summaries.get(videoId);
    if (cached) {
      // Most recently used last, so it's kept when the store is trimmed
      this.summaries.delete(videoId);
      this.summaries.set(videoId, cached);
      return cached;
    }
    let summary: TrackSummary | null = null;
    const known = this.ready.get(videoId);
    if (known) {
      summary = summarize(known.analysis);
    } else {
      // Downloading and decoding is heavy: keep it away from transitions
      while ((this.mix || this.mixSoon) && !this.stopped) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
      }
      try {
        const audio = await this.fetchAudio(videoId);
        if (audio && !this.stopped) {
          const track = await decodeAndAnalyze(
            videoId,
            audio.bytes,
            this.context?.sampleRate ?? 48000,
          );
          // With Apple's analysis too, as the planner will see the song
          const withApple = await this.withAppleAnalysis(track, {
            title,
            artist,
          });
          summary = summarize(withApple.analysis);
        }
      } catch {
        // Unknown songs are ordered as neutral
      }
    }
    // Only keep what worked, so a failed download is retried next time
    if (summary) this.remember(videoId, summary);
    return summary;
  }

  private remember(videoId: string, summary: TrackSummary) {
    this.summaries.delete(videoId);
    this.summaries.set(videoId, summary);
    saveSummaries(this.summaries);
  }

  /**
   * Mix into the next song now, by hand: on the first bar (or a phrase close
   * by) that leaves room to set the transition up. Only the song's ending is
   * kept decoded, so mid-song it's decoded again from where it is.
   * Resolves false when there's nothing to mix into yet.
   */
  async mixNow(): Promise<boolean> {
    const video = this.video;
    const id = this.currentVideoId();
    const context = this.context;
    if (!video || !id || !context || this.mix || this.rush) return false;
    const base = this.ready.get(id);
    const nextId = this.next?.videoId;
    if (!base || !nextId || !this.ready.has(nextId)) return false;

    this.rush = { videoId: id, track: null };
    try {
      // The ending we keep already covers it when we're close to it
      const firstBeat = base.analysis.end.beats[0] ?? Number.POSITIVE_INFINITY;
      let track = base;
      if (this.songTime(video) + MIX_NOW_LEAD < firstBeat) {
        const audio = await this.fetchAudio(id);
        if (!audio) throw new Error('no audio for mix now');
        track = await decodeWindow(
          base,
          audio.bytes,
          context.sampleRate,
          this.songTime(video),
          MIX_NOW_SECONDS,
        );
      }
      if (this.rush?.videoId !== id || this.stopped) return false;
      this.rush = { videoId: id, track };
      this.planKey = '';
      this.schedule(0);
      return true;
    } catch {
      if (this.rush?.videoId === id) this.rush = null;
      return false;
    }
  }

  private timelineCache: { key: string; value: TransitionTimeline } | null =
    null;

  /**
   * The planned (or playing) transition laid out for drawing, null when
   * there's none. Computed once per plan
   */
  timeline(): TransitionTimeline | null {
    const mix = this.mix;
    const plan = mix?.plan ?? this.plan;
    const fromId = mix?.fromId ?? this.currentId;
    const toId = mix?.toId ?? this.next?.videoId;
    if (!plan || !fromId) return null;
    const from =
      (!mix && this.rush?.videoId === fromId ? this.rush.track : null) ??
      this.ready.get(fromId);
    if (!from) return null;
    const to = toId ? this.ready.get(toId) : undefined;
    const key = JSON.stringify([
      fromId,
      toId,
      Boolean(to),
      plan.style,
      plan.effect,
      plan.mixOut,
      plan.mixIn,
      plan.duration,
      plan.rate,
      mix?.fromTitle ?? this.currentTitle,
      mix?.toTitle ?? this.next?.title,
    ]);
    if (this.timelineCache?.key === key) return this.timelineCache.value;

    const start = plan.mixOut - TIMELINE_MARGIN;
    const end = plan.mixOut + plan.duration + TIMELINE_MARGIN;
    const step = 1 / TIMELINE_RATE;
    const count = Math.ceil((end - start) / step);
    const out = {
      start,
      step,
      ...bandLevels(from.tail, from.tailStart, start, step, count),
    };
    // The next song on the same timeline: song time = mixIn + rate x (t - mixOut)
    const rate = plan.rate || 1;
    const toTimeline = (time: number) => plan.mixOut + ((time - plan.mixIn) / rate);
    let incoming: TimelineLane | null = null;
    if (to) {
      const inFrom = Math.max(0, plan.mixIn + (rate * (start - plan.mixOut)));
      const laneStart = toTimeline(inFrom);
      const laneCount = Math.max(0, Math.ceil((end - laneStart) / step));
      incoming = {
        start: laneStart,
        step,
        ...bandLevels(to.head, 0, inFrom, step * rate, laneCount),
      };
    }
    const within = (time: number) => time >= start && time <= end;
    const swapAt: [number, number] | undefined =
      plan.style !== 'blend'
        ? undefined
        : plan.holdOutgoing
          ? [1 - ((plan.beat || 0.5) / 2 / plan.duration), 1]
          : (plan.bassSwapAt ??
            (effectById(plan.effect)?.outgoing.some((lane) => lane.param === 'bass')
              ? [0.375, 0.625]
              : [0.45, 0.55]));
    const value: TransitionTimeline = {
      plan,
      fromTitle: mix?.fromTitle ?? this.currentTitle,
      toTitle: mix?.toTitle ?? this.next?.title,
      fromArt: mix?.fromArt ?? this.currentArt,
      toArt: mix?.toArt ?? this.next?.art,
      start,
      end,
      out,
      in: incoming,
      outBars: from.analysis.end.downbeats.filter(within),
      inBars: to ? to.analysis.start.downbeats.map(toTimeline).filter(within) : [],
      bassSwap: swapAt && [
        plan.mixOut + (swapAt[0] * plan.duration),
        plan.mixOut + (swapAt[1] * plan.duration),
      ],
      vocal:
        plan.landsOnVocal === undefined ? undefined : toTimeline(plan.landsOnVocal),
    };
    this.timelineCache = { key, value };
    return value;
  }

  /** Where playback is on the current timeline (the outgoing song's seconds) */
  timelinePosition(): number | null {
    const mix = this.mix;
    if (mix && this.context) return mix.outPosition(this.context.currentTime);
    const video = this.video;
    return video ? this.songTime(video) : null;
  }

  /** The song the player is on */
  playingVideoId() {
    return this.currentVideoId();
  }

  /** A transition is playing right now */
  get mixing() {
    return this.mix !== null;
  }

  private ensureTrack(videoId: string) {
    const failed = this.failedAt.get(videoId);
    if (failed && Date.now() - failed < RETRY_FAILED_MS) return;
    if (this.tracks.has(videoId)) return;

    const promise = (async () => {
      const audio = await this.fetchAudio(videoId);
      if (!audio || this.stopped) return null;
      const track = await decodeAndAnalyze(
        videoId,
        audio.bytes,
        this.context?.sampleRate ?? 48000,
      );
      return {
        ...(await this.withAppleAnalysis(track)),
        quality: audio.quality,
        lowQuality: audio.lowQuality,
      };
    })()
      .catch(() => null)
      .then((track) => {
        if (this.tracks.get(videoId) !== promise) return track;
        if (track) {
          this.ready.set(videoId, track);
          this.failedAt.delete(videoId);
          // Songs AutoMix plays are remembered for Reorder too
          if (!this.summaries.has(videoId)) {
            this.remember(videoId, summarize(track.analysis));
          }
        } else {
          this.tracks.delete(videoId);
          this.failedAt.set(videoId, Date.now());
        }
        this.schedule(0);
        return track;
      });
    this.tracks.set(videoId, promise);
  }

  /**
   * Merges Apple Music's analysis of the song in, when Apple has the same
   * recording and its timing lines up with our copy
   */
  private async withAppleAnalysis(
    track: AnalyzedTrack,
    info = this.songInfo.get(track.videoId),
  ) {
    if (!this.config.appleAnalysis || !info?.title) return track;
    const apple = await this.fetchApple({
      ...info,
      duration: track.analysis.duration,
    }).catch(() => null);
    if (!apple) return track;
    const alignment = alignApple(
      apple,
      track.loudness,
      LOUDNESS_HOP,
      track.analysis.beats,
      track.analysis.downbeats,
    );
    if (!alignment) return track;
    const analysis = withApple(track.analysis, apple, alignment);
    if (this.debugEnabled()) {
      const r = (value: number) => Math.round(value * 100) / 100;
      console.info('[AutoMix] Apple Music analysis', info.title, {
        appleId: apple.id,
        offset: alignment.offset,
        gridOk: alignment.gridOk,
        detail: alignment.detail,
        introEnd: r(analysis.introEnd),
        outroStart: r(analysis.outroStart),
        trailingSilenceStart: r(analysis.trailingSilenceStart),
        decayPoint: r(analysis.decayPoint),
        endBpm: r(analysis.end.bpm),
        endDrift: r(analysis.end.drift),
        tempoConfidence: r(analysis.tempoConfidence),
        keys: [analysis.start.key?.camelot, analysis.end.key?.camelot],
        phrases: analysis.phrases?.length,
        vocalEntry: analysis.vocalEntry && r(analysis.vocalEntry),
      });
    }
    return { ...track, analysis };
  }

  private pruneTracks(keep: (string | null | undefined)[]) {
    for (const id of [...this.songInfo.keys()]) {
      if (!keep.includes(id)) this.songInfo.delete(id);
    }
    for (const id of [...this.tracks.keys()]) {
      if (!keep.includes(id)) {
        this.tracks.delete(id);
        this.ready.delete(id);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Idle loop: follow the queue, analyse, plan, and trigger the mix     */
  /* ------------------------------------------------------------------ */

  private tick() {
    if (this.stopped) return;
    try {
      if (this.mix) {
        this.tickMix();
        this.schedule(FAST_TICK_MS);
        return;
      }
      this.schedule(this.tickIdle());
    } catch (error) {
      console.error('[AutoMix] tick failed', error);
      if (this.mix) this.abort();
      this.schedule(IDLE_TICK_MS);
    }
  }

  /**
   * React to queue edits ("Play next", drag and drop, removals) right away
   * instead of waiting for the next poll. The player can swap the queue
   * store when a new queue starts, so this re-subscribes when it changes.
   */
  private watchQueue() {
    const store = getQueueStore();
    if (store === this.queueStore) return;
    this.unsubscribeQueue?.();
    this.unsubscribeQueue = null;
    this.queueStore = store;
    if (!store) return;

    const unsubscribe = store.subscribe(this.onQueueChanged);
    this.unsubscribeQueue =
      typeof unsubscribe === 'function' ? (unsubscribe as () => void) : null;
  }

  private readonly onQueueChanged = () => {
    if (this.mix) {
      // Re-read soon so the song after the incoming one gets prefetched
      this.lastQueueRead = 0;
      return;
    }
    const queue = readQueue(this.currentId);
    if (
      queue?.next?.videoId !== this.next?.videoId ||
      queue?.afterNext?.videoId !== this.afterNext?.videoId ||
      (queue?.repeatMode === 'ONE') !== this.repeatOne
    ) {
      this.lastQueueRead = 0;
      this.schedule(0);
    }
  };

  private refreshQueue(force = false) {
    if (!force && Date.now() - this.lastQueueRead < QUEUE_REFRESH_MS) return;
    this.lastQueueRead = Date.now();

    const queue = readQueue(this.currentId);
    for (const track of [queue?.current, queue?.next, queue?.afterNext]) {
      if (track) {
        this.songInfo.set(track.videoId, {
          title: track.title,
          artist: track.artist,
        });
      }
    }
    this.next = queue?.next ?? null;
    this.afterNext = queue?.afterNext ?? null;
    this.currentTitle = queue?.current?.title ?? this.currentTitle;
    this.currentArt = queue?.current?.art ?? this.currentArt;
    this.repeatOne = queue?.repeatMode === 'ONE';
    this.sameAlbum = Boolean(
      queue?.current?.albumId && queue.current.albumId === queue.next?.albumId,
    );
  }

  private mismatchSince: number | null = null;
  /**
   * Song (video id) whose playing version already matched the analysed
   * audio, for this play of it. In a song's last ~10 s YouTube Music loads
   * the next song into the player and its duration jumps to the next
   * song's, so it's only checked until it has matched once per play
   */
  private versionMatched: string | null = null;

  private playingDuration(video: HTMLVideoElement) {
    try {
      // On a shared (gapless) timeline the player's duration is how far it
      // has buffered, not the song's length
      if (this.timelineOffset(video) > 0) {
        const length = Number(
          this.api.getPlayerResponse?.()?.videoDetails?.lengthSeconds,
        );
        if (length > 0) return length;
      }
      const duration = this.api.getDuration();
      if (Number.isFinite(duration) && duration > 0) return duration;
    } catch {
      // Fall back to the element
    }
    return video.duration;
  }

  private isOtherVersion(video: HTMLVideoElement, from: AnalyzedTrack) {
    if (this.versionMatched === from.videoId) return false;
    const duration = this.playingDuration(video);
    const differs =
      !video.seeking &&
      video.readyState >= 1 &&
      Number.isFinite(duration) &&
      duration > 0 &&
      Math.abs(duration - from.analysis.duration) > 2;
    if (!differs) {
      this.mismatchSince = null;
      if (video.readyState >= 1 && duration > 0) {
        this.versionMatched = from.videoId;
      }
      return false;
    }
    this.mismatchSince ??= Date.now();
    return Date.now() - this.mismatchSince > MISMATCH_GRACE_MS;
  }

  private tickIdle(): number {
    // Set again below while a transition is close
    this.mixSoon = false;
    const video = this.video;
    const id = this.currentVideoId();

    if (!this.config.active || !video || !id) {
      this.emit({ phase: 'inactive' });
      return IDLE_TICK_MS;
    }

    // A mix-now is for the song it was asked on
    if (this.rush && this.rush.videoId !== id) this.rush = null;

    if (id !== this.currentId) {
      this.currentId = id;
      this.mismatchSince = null;
      // Every play of a song is checked again (it may be a different stream)
      this.versionMatched = null;
      this.currentTitle = this.api.getVideoData()?.title ?? '';
      this.currentArt = largeArt(
        this.api.getPlayerResponse?.()?.videoDetails?.thumbnail?.thumbnails?.at(
          -1,
        )?.url,
      );
      this.plan = null;
      this.planKey = '';
      this.refreshQueue(true);
    } else {
      this.refreshQueue();
    }

    this.watchQueue();

    const nextId = this.next?.videoId;
    const afterNextId = this.afterNext?.videoId;
    this.pruneTracks([id, nextId, afterNextId]);

    const blocked: AutoMixWaitReason | null =
      !nextId || nextId === id
        ? 'no-next'
        : this.repeatOne || video.loop
          ? 'repeat-one'
          : this.config.respectAlbums && this.sameAlbum && !this.rush
            ? 'same-album'
            : null;
    if (blocked || !nextId) {
      this.plan = null;
      this.emit({ phase: 'waiting', reason: blocked ?? 'no-next' });
      return IDLE_TICK_MS;
    }

    this.ensureTrack(id);
    this.ensureTrack(nextId);

    // Sought back before where a mix-now was decoded from: it can't play
    if (this.rush?.track && this.songTime(video) < this.rush.track.tailStart) {
      this.rush = null;
    }
    const rushed = this.rush?.track ?? null;
    const from = rushed ?? this.ready.get(id);
    if (!from) {
      this.emit(
        this.tracks.has(id)
          ? { phase: 'analyzing' }
          : { phase: 'waiting', reason: 'analysis-failed' },
      );
      return IDLE_TICK_MS;
    }

    // Look one song further so reordering the queue is usually covered
    const to = this.ready.get(nextId);
    if (to && afterNextId && afterNextId !== id) this.ensureTrack(afterNextId);

    // The next song changed too late (or couldn't be analysed): rather than
    // stopping dead, fade into it once the end of this song gets close
    const late =
      this.songTime(video) >
      from.analysis.trailingSilenceStart - LATE_PLAN_SECONDS;
    if (!to && !late) {
      this.emit(
        this.tracks.has(nextId)
          ? { phase: 'analyzing' }
          : { phase: 'waiting', reason: 'analysis-failed' },
      );
      return IDLE_TICK_MS;
    }

    // The decoded audio must be the stream that's actually playing. The
    // element's duration wobbles while it seeks / re-buffers, so ask the
    // player first and only believe a mismatch that lasts
    if (this.isOtherVersion(video, from)) {
      this.emit({ phase: 'waiting', reason: 'version-mismatch' });
      return IDLE_TICK_MS;
    }

    const fromAnalysis = from.analysis;
    const toAnalysis = to ? to.analysis : unknownTrack;
    const splitStretch =
      this.canSplit() && this.noSplitFor !== `${id}>${nextId}`;
    const key = JSON.stringify([
      id,
      nextId,
      Boolean(to),
      splitStretch,
      this.config,
      Boolean(rushed),
    ]);
    const tooLate =
      this.plan &&
      this.songTime(video) > this.plan.mixOut - prerollFor(this.plan) + 0.5;
    if (key !== this.planKey || tooLate) {
      this.planKey = key;
      let plan = planTransition(fromAnalysis, toAnalysis, {
        preference: to ? this.config.transition : 'smooth',
        blendBeats: this.config.blendBeats,
        maxStretch: this.config.maxStretch,
        effects: this.config.effects,
        spotifyStyle: this.config.spotifyStyle,
        asap: Boolean(rushed),
        splitStretch,
        smoothSeconds: this.config.smoothSeconds,
        beatOnly: this.config.beatOnly,
        earliestMixOut: Math.max(
          this.songTime(video) + MIX_NOW_LEAD,
          from.tailStart + MIX_NOW_LEAD,
        ),
      });
      // Beat grids get the kicks within a few tens of ms: line them up on
      // what the two copies actually play
      if (plan && to) {
        const aligned = alignKicks(plan, from.tail, from.tailStart, to.head);
        // Swap the basses where the next song's bass really comes in
        const bassSwapAt = bassSwapWindow(aligned.plan, to.analysis);
        plan = {
          ...aligned.plan,
          bassSwapAt,
          checks: {
            ...aligned.plan.checks,
            kickNudgeMs: Math.round(aligned.nudge * 1000),
            bassSwapAt: bassSwapAt
              ? bassSwapAt.map((x) => x.toFixed(2)).join('-')
              : '-',
          },
        };
      }
      this.plan = plan && !to ? { ...plan, reason: 'late-change' } : plan;
      if (this.debugEnabled()) {
        console.info('[AutoMix] plan', plan?.style ?? 'none', plan?.reason, {
          mixOut: plan?.mixOut,
          mixIn: plan?.mixIn,
          duration: plan?.duration,
          ...plan?.checks,
        });
      }
    }

    const plan = this.plan;
    if (!plan) {
      this.emit({ phase: 'waiting', reason: 'no-room' });
      return IDLE_TICK_MS;
    }

    this.emit({
      phase: 'ready',
      plan,
      fromTitle: this.currentTitle,
      toTitle: this.next?.title,
      lowQuality: [from, to]
        .filter((track) => track?.lowQuality)
        .map((track) => track?.quality)
        .join(', ') || undefined,
    });

    const remaining = plan.mixOut - prerollFor(plan) - this.songTime(video);
    this.mixSoon = remaining < 15;
    // The audio a transition plays was decoded minutes ago and may have been
    // paged out to disk since; reading it back in on the audio thread when
    // the transition starts makes it miss its deadline (a stutter)
    const pair = `${from.videoId}>${to?.videoId ?? ''}`;
    if (remaining < 8 && this.warmedFor !== pair) {
      this.warmedFor = pair;
      this.warm(from.tail);
      if (to) this.warm(to.head);
    }
    if (
      remaining <= 0.03 &&
      remaining > -0.5 &&
      !video.paused &&
      !video.seeking &&
      Math.abs(video.playbackRate - 1) < 0.01 &&
      this.context?.state === 'running'
    ) {
      this.startMix(from, plan, to);
      return FAST_TICK_MS;
    }

    return remaining < 1.5 ? FAST_TICK_MS : IDLE_TICK_MS;
  }

  /* ------------------------------------------------------------------ */
  /* The mix                                                             */
  /* ------------------------------------------------------------------ */

  /**
   * The outgoing copy's audio chain. Only the filters this transition
   * sweeps are inserted, so the rest of the time the copy plays untouched.
   */
  private buildOutgoing(
    context: AudioContext,
    from: AnalyzedTrack,
    plan: TransitionPlan,
  ): OutgoingChain {
    const source = context.createBufferSource();
    source.buffer = from.tail;

    const filter = (type: BiquadFilterType, frequency: number, q = 0.7) => {
      const node = context.createBiquadFilter();
      node.type = type;
      node.frequency.value = frequency;
      node.Q.value = q;
      return node;
    };

    const style = plan.style === 'blend' ? effectById(plan.effect) : undefined;
    if (style) return this.buildDressedOutgoing(context, source, style, plan);

    const sweepsHighpass =
      plan.style === 'cut' || (plan.style === 'blend' && !plan.holdOutgoing);
    const highpass = sweepsHighpass ? filter('highpass', 20, 0.9) : undefined;
    const lowShelf =
      plan.style === 'blend' ? filter('lowshelf', CROSSOVER_HZ) : undefined;
    if (lowShelf) lowShelf.gain.value = 0;
    const lowpass =
      plan.style === 'smooth' && !plan.holdOutgoing
        ? filter('lowpass', context.sampleRate / 2)
        : undefined;

    const dry = context.createGain();
    dry.gain.value = 0;
    const master = context.createGain();

    const filters = [highpass, lowShelf, lowpass].filter(
      (node): node is BiquadFilterNode => Boolean(node),
    );
    const sourceGain = context.createGain();
    const input = context.createGain();
    source.connect(sourceGain).connect(input);
    let tap: AudioNode = input;
    for (const node of filters) tap = tap.connect(node);
    tap.connect(dry).connect(master).connect(context.destination);

    return {
      source,
      sourceGain,
      input,
      dry,
      master,
      highpass,
      lowShelf,
      lowpass,
      tap,
      nodes: [source, sourceGain, input, ...filters, dry, master],
      shared: [],
    };
  }

  /**
   * The outgoing chain of an effect style, after Apple's per-song graph:
   * input level, high-pass, low-pass, then the dry song alongside a send
   * through a beat-synced echo and / or a reverb, all into the song's level
   */
  private buildDressedOutgoing(
    context: AudioContext,
    source: AudioBufferSourceNode,
    style: EffectStyle,
    plan: TransitionPlan,
  ): OutgoingChain {
    const sourceGain = context.createGain();
    const input = context.createGain();
    const highpass = context.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 10;
    const lowpass = context.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 20_000;
    const bass = context.createBiquadFilter();
    bass.type = 'lowshelf';
    bass.frequency.value = CROSSOVER_HZ;
    bass.gain.value = 0;
    const dryMix = context.createGain();
    const send = context.createGain();
    send.gain.value = 0;
    const wet = context.createGain();
    wet.gain.value = 0;
    const dry = context.createGain();
    dry.gain.value = 0;
    const master = context.createGain();

    const nodes: AudioNode[] = [
      source,
      sourceGain,
      input,
      highpass,
      lowpass,
      bass,
      dryMix,
      send,
      wet,
      dry,
      master,
    ];
    let repeat: OutgoingChain['repeat'];
    if (style.repeats) {
      const song = context.createGain();
      input.connect(song).connect(highpass);
      repeat = { song, into: highpass, loops: [] };
      nodes.push(song);
    } else {
      input.connect(highpass);
    }
    source.connect(sourceGain).connect(input);
    highpass.connect(lowpass).connect(bass);
    bass.connect(dryMix).connect(dry);
    bass.connect(send);
    const fx: OutgoingChain['fx'] = {
      gain: dry.gain,
      input: input.gain,
      highpass: highpass.frequency,
      lowpass: lowpass.frequency,
      bass: bass.gain,
      send: send.gain,
      wet: wet.gain,
      dry: dryMix.gain,
    };

    let sendOut: AudioNode = send;
    if (style.delay) {
      // Echoes a beat apart, darkened on every repeat; what isn't echoed
      // passes on as is (Apple's delay unit dry / wet)
      const echoes = context.createDelay(2.5);
      echoes.delayTime.value = Math.min(2.01, plan.beat || 0.5);
      const echoLowpass = context.createBiquadFilter();
      echoLowpass.type = 'lowpass';
      const feedback = context.createGain();
      feedback.gain.value = 0;
      const echoLevel = context.createGain();
      echoLevel.gain.value = 0;
      const passLevel = context.createGain();
      const delayOut = context.createGain();
      send.connect(echoes).connect(echoLowpass).connect(echoLevel).connect(delayOut);
      echoLowpass.connect(feedback).connect(echoes);
      send.connect(passLevel).connect(delayOut);
      nodes.push(echoes, echoLowpass, feedback, echoLevel, passLevel, delayOut);
      Object.assign(fx, {
        delayMix: echoLevel.gain,
        delayDry: passLevel.gain,
        delayFeedback: feedback.gain,
        delayLowpass: echoLowpass.frequency,
      });
      sendOut = delayOut;
    }
    if (style.reverb) {
      const reverb = context.createConvolver();
      reverb.buffer = reverbImpulse(context, style.reverb);
      sendOut = sendOut.connect(reverb);
      nodes.push(reverb);
    }
    sendOut.connect(wet).connect(dry);
    dry.connect(master).connect(context.destination);

    return {
      source,
      sourceGain,
      input,
      dry,
      master,
      tap: bass,
      fx,
      repeat,
      nodes,
      shared: [],
    };
  }

  /**
   * A beat repeater: the slice of the song heard at the first point loops in
   * its place, restarting from the slice's start (and shorter) at each point
   */
  private scheduleRepeats(
    context: AudioContext,
    chain: OutgoingChain,
    style: EffectStyle,
    mixAt: number,
    duration: number,
    clock: OutgoingClock,
  ) {
    const buffer = chain.source.buffer;
    if (!chain.repeat || !style.repeats || !buffer) return;
    const end = Math.min(
      mixAt + duration,
      style.repeatEnd === undefined
        ? Number.POSITIVE_INFINITY
        : timeIn(style.repeatEnd, mixAt, duration),
    );
    const points = style.repeats.map((point) => ({
      at: timeIn(point.at, mixAt, duration),
      bars: point.bars,
    }));
    const first = points[0].at;
    const sliceStart = clock.position(first) - clock.tailStart;
    chain.repeat.song.gain.setValueAtTime(0, first);
    if (end < mixAt + duration) chain.repeat.song.gain.setValueAtTime(1, end);
    points.forEach((point, i) => {
      const until = Math.min(end, points[i + 1]?.at ?? end);
      if (until <= point.at) return;
      const loop = context.createBufferSource();
      loop.buffer = buffer;
      loop.loop = true;
      loop.loopStart = sliceStart;
      loop.loopEnd = sliceStart + (point.bars * 4 * clock.beat);
      // The copy may be gliding to the new song's tempo: loop at its speed
      loop.playbackRate.value = clock.rate(point.at);
      loop.connect(chain.repeat!.into);
      loop.start(point.at, sliceStart);
      loop.stop(until);
      chain.nodes.push(loop);
      chain.repeat!.loops.push(loop);
    });
  }

  /** Schedules the outgoing side of the transition, sample accurately */
  private scheduleOutgoing(
    context: AudioContext,
    chain: OutgoingChain,
    plan: TransitionPlan,
    mixAt: number,
    /** Needed by an effect style's beat repeater */
    clock?: OutgoingClock,
  ) {
    const { dry, highpass, lowShelf, lowpass } = chain;
    const duration = plan.duration;

    switch (plan.style) {
      case 'blend': {
        const style = effectById(plan.effect);
        if (chain.fx && style) {
          scheduleLanes(
            chain.fx,
            withBassSwap(style, plan.bassSwapAt).outgoing,
            mixAt,
            duration,
            'outgoing',
          );
          if (clock) {
            this.scheduleRepeats(context, chain, style, mixAt, duration, clock);
          }
          chain.source.stop(mixAt + duration + 0.1);
          break;
        }
        if (plan.holdOutgoing) {
          // The old song keeps its full ending; bass swaps on its final hit,
          // which rings out briefly under the next song
          const hit = mixAt + duration;
          const swap = bassSwap(plan, mixAt);
          lowShelf?.gain.setValueAtTime(0, swap.from);
          lowShelf?.gain.linearRampToValueAtTime(-30, swap.to);
          dry.gain.setValueAtTime(1, hit + 0.05);
          dry.gain.setTargetAtTime(0, hit + 0.05, ENDING_RING / 4);
          chain.source.stop(hit + ENDING_RING + 0.2);
          break;
        }
        // Equal-power crossfade with a DJ style bass swap halfway through
        dry.gain.setValueCurveAtTime(equalPowerOut, mixAt, duration);
        const swap = bassSwap(plan, mixAt);
        lowShelf?.gain.setValueAtTime(0, swap.from);
        lowShelf?.gain.linearRampToValueAtTime(-30, swap.to);
        highpass?.frequency.setValueAtTime(20, mixAt + (duration * 0.55));
        highpass?.frequency.exponentialRampToValueAtTime(400, mixAt + duration);
        chain.source.stop(mixAt + duration + 0.1);
        break;
      }

      case 'cut': {
        // Filter build-up over the last bar, an optional echo throw, then a
        // hard cut on the downbeat
        const beat = plan.beat || 0.5;
        const buildFrom = Math.max(context.currentTime, mixAt - (beat * 4));
        highpass?.frequency.setValueAtTime(20, buildFrom);
        highpass?.frequency.exponentialRampToValueAtTime(900, mixAt);

        if (this.config.cutEcho) {
          const send = context.createGain();
          send.gain.value = 0;
          const delay = context.createDelay(2);
          delay.delayTime.value = Math.min(1.9, beat * 0.75);
          const feedback = context.createGain();
          feedback.gain.value = 0.45;
          const echoFilter = context.createBiquadFilter();
          echoFilter.type = 'highpass';
          echoFilter.frequency.value = 350;

          chain.tap.connect(send).connect(delay).connect(echoFilter);
          delay.connect(feedback).connect(delay);
          echoFilter.connect(chain.master);
          chain.nodes.push(send, delay, feedback, echoFilter);

          send.gain.setValueAtTime(0, mixAt - beat);
          send.gain.linearRampToValueAtTime(0.6, mixAt - 0.01);
          send.gain.linearRampToValueAtTime(0, mixAt + 0.02);
          feedback.gain.setValueAtTime(0.45, mixAt + (beat * 4));
          feedback.gain.linearRampToValueAtTime(0, mixAt + (beat * 6));
        }

        dry.gain.setValueAtTime(1, mixAt - 0.01);
        dry.gain.linearRampToValueAtTime(0, mixAt + 0.04);
        chain.source.stop(mixAt + 0.1);
        break;
      }

      case 'segue': {
        // The song has played its ending; let what's left of the tail die
        // away underneath the next song
        dry.gain.setValueAtTime(1, mixAt);
        dry.gain.setTargetAtTime(0, mixAt, duration / 4);
        chain.source.stop(mixAt + duration + 0.1);
        break;
      }

      case 'smooth': {
        if (plan.effect === CROSSFADE_REVERB.id) {
          // Apple's reverb wash: the send opens over the first seconds and
          // the tail rings on after the song is gone
          const send = context.createGain();
          send.gain.value = 0;
          const reverb = context.createConvolver();
          reverb.buffer = reverbImpulse(context, CROSSFADE_REVERB.decay);
          chain.tap.connect(send).connect(reverb).connect(chain.master);
          chain.nodes.push(send, reverb);
          send.gain.setValueAtTime(0, mixAt);
          send.gain.linearRampToValueAtTime(
            CROSSFADE_REVERB.send,
            mixAt + CROSSFADE_REVERB.sendSeconds,
          );
        }
        if (plan.holdOutgoing) {
          // Keep the whole ending; the final hit rings out under the next song
          const hit = mixAt + duration;
          dry.gain.setValueAtTime(1, hit + 0.05);
          dry.gain.setTargetAtTime(0, hit + 0.05, ENDING_RING / 4);
          chain.source.stop(hit + ENDING_RING + 0.2);
          break;
        }
        // Long equal-power fade, the outgoing song slowly drifts behind a lowpass
        dry.gain.setValueCurveAtTime(equalPowerOut, mixAt, duration);
        lowpass?.frequency.setValueAtTime(20000, mixAt);
        lowpass?.frequency.exponentialRampToValueAtTime(700, mixAt + duration);
        chain.source.stop(mixAt + duration + 0.1);
        break;
      }
    }
  }

  /**
   * Plays the start of the incoming song from our decoded copy, scheduled to
   * the sample, so a beat cut lands exactly on the downbeat however long the
   * player takes to load and seek. The player is handed over later.
   */
  /**
   * Our copy of the incoming song's start: played as is when no tempo
   * change is needed, otherwise time-stretched (pitch kept) at the planned
   * rate, gliding back to normal speed after the mix before the player
   * takes over. The player's own time-stretch sounds warbly, so it's only
   * ever stretched while silent. Undefined if the copy can't cover it.
   */
  private buildIncomingHead(
    context: AudioContext,
    to: AnalyzedTrack,
    plan: TransitionPlan,
    mixAt: number,
    mixEnd: number,
    volume: number,
    /** Glide to 1x during the blend (with the old song) instead of after it */
    glideDuring = false,
  ): IncomingHead | undefined {
    const stretched = Math.abs(plan.rate - 1) >= 0.001;
    const stretch = this.stretch;
    if (stretched && !stretch) return undefined;

    // Run the stretcher a moment early so it's settled when it's heard
    const lead = stretched ? Math.min(1, plan.mixIn / plan.rate) : 0;
    const steps: RateStep[] = [{ at: mixAt - lead, rate: plan.rate }];
    if (stretched && glideDuring) {
      steps.push(...blendGlide(mixAt, mixEnd, plan.rate));
    } else if (stretched) {
      for (let t = GLIDE_STEP; t <= GLIDE_SECONDS; t += GLIDE_STEP) {
        const x = t / GLIDE_SECONDS;
        const eased = x * x * (3 - (2 * x));
        steps.push({
          at: mixEnd + t - GLIDE_STEP,
          rate: plan.rate + ((1 - plan.rate) * eased),
        });
      }
    }
    const steady = steps[steps.length - 1].at;
    const rate = (time: number) => {
      let current = plan.rate;
      for (const step of steps) if (step.at <= time) current = step.rate;
      return current;
    };
    const position = (time: number) => {
      // Before the copy starts, extrapolate (negative = not started yet)
      let at = mixAt;
      let pos = plan.mixIn;
      if (time <= steps[0].at) return pos + (plan.rate * (time - at));
      pos -= plan.rate * lead;
      at = steps[0].at;
      for (let i = 0; i < steps.length; i++) {
        const until = Math.min(time, steps[i + 1]?.at ?? time);
        pos += steps[i].rate * (until - at);
        at = until;
        if (until >= time) break;
      }
      return pos;
    };

    // A blend's bass swap needs our copy (the player can't be EQ'd), so the
    // player only takes over once the swap is done, or once an effect
    // style's filters have opened all the way
    const style = plan.style === 'blend' ? effectById(plan.effect) : undefined;
    const handOverFrom = Math.max(
      stretched
        ? steady + 0.25
        : mixAt + (plan.filterIn ? filterOpenBy(plan) : 0.3),
      plan.style === 'blend' ? bassSwap(plan, mixAt).to + 0.1 : 0,
      style ? mixAt + plan.duration + 0.1 : 0,
    );
    // Room for the player to catch up before the copy runs out
    if (position(handOverFrom) + 6 > to.head.duration) return undefined;

    const gain = context.createGain();
    gain.gain.value = 0;
    const master = context.createGain();
    master.gain.value = volume;

    let source: AudioBufferSourceNode | StretchNode;
    let advance: IncomingHead['advance'];
    if (stretch && stretched) {
      source = stretch;
      const channels = Array.from({ length: to.head.numberOfChannels }, (_, c) =>
        to.head.getChannelData(c).slice(),
      );
      // Messages are handled in order, so no need to wait between them
      Promise.all([
        stretch.dropBuffers(),
        stretch.addBuffers(
          channels,
          channels.map((channel) => channel.buffer),
        ),
        stretch.schedule({
          outputTime: context.currentTime,
          output: steps[0].at,
          active: true,
          input: position(steps[0].at),
          rate: steps[0].rate,
        }),
      ]).catch(() => {});
      // The stretcher only keeps one change ahead (scheduling another drops
      // the ones before it), so send each step once the previous one began
      let sent = 1;
      advance = (now) => {
        while (sent < steps.length && now >= steps[sent - 1].at) {
          stretch
            .schedule({
              outputTime: steps[sent - 1].at + 0.001,
              output: steps[sent].at,
              rate: steps[sent].rate,
            })
            .catch(() => {});
          sent++;
        }
      };
    } else {
      const buffer = context.createBufferSource();
      buffer.buffer = to.head;
      buffer.start(mixAt, plan.mixIn);
      source = buffer;
    }

    const stages: AudioNode[] = [];
    if (style) {
      // Apple's incoming lanes: the song comes in through its filters
      const highpass = context.createBiquadFilter();
      highpass.type = 'highpass';
      const lowpass = context.createBiquadFilter();
      lowpass.type = 'lowpass';
      const bass = context.createBiquadFilter();
      bass.type = 'lowshelf';
      bass.frequency.value = CROSSOVER_HZ;
      // Only the lanes a style has are scheduled: the rest must start open
      // (a biquad's default is 350 Hz, which muffles or thins the song)
      highpass.frequency.value = EFFECT_DEFAULTS.highpass;
      lowpass.frequency.value = EFFECT_DEFAULTS.lowpass;
      stages.push(highpass, lowpass, bass, gain);
      scheduleLanes(
        {
          gain: gain.gain,
          highpass: highpass.frequency,
          lowpass: lowpass.frequency,
          bass: bass.gain,
        },
        withBassSwap(style, plan.bassSwapAt).incoming,
        mixAt,
        plan.duration,
        'incoming',
      );
    } else if (plan.filterIn) {
      // Thin at first so the two songs don't muddy, opening up fully by the
      // time the old song is gone (or on its final hit)
      const highpass = context.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.Q.value = 0.7;
      highpass.frequency.setValueAtTime(FILTER_IN_HZ, mixAt);
      highpass.frequency.exponentialRampToValueAtTime(
        20,
        mixAt + filterOpenBy(plan),
      );
      stages.push(highpass);
    }
    if (plan.style === 'blend' && !style) {
      // The other half of the bass swap: no incoming bass until the old
      // song's bass goes out
      const lowShelf = context.createBiquadFilter();
      lowShelf.type = 'lowshelf';
      lowShelf.frequency.value = CROSSOVER_HZ;
      lowShelf.gain.value = -30;
      const swap = bassSwap(plan, mixAt);
      lowShelf.gain.setValueAtTime(-30, swap.from);
      lowShelf.gain.linearRampToValueAtTime(0, swap.to);
      stages.push(lowShelf);
    }
    if (!style) stages.push(gain);
    stages
      .reduce<AudioNode>((from, node) => from.connect(node), source)
      .connect(master)
      .connect(context.destination);

    // With an effect style, the level is one of the style's lanes
    if (plan.style === 'cut' || plan.style === 'segue') {
      // The incoming song starts as itself: no fade-in on its first note
      gain.gain.setValueAtTime(0, mixAt);
      gain.gain.linearRampToValueAtTime(1, mixAt + 0.004);
    } else if (!style) {
      gain.gain.setValueCurveAtTime(equalPowerIn, mixAt, plan.duration);
    }

    return {
      source,
      gain,
      master,
      masterTarget: volume,
      endAt: steady + (to.head.duration - position(steady)),
      handOverFrom,
      position,
      rate,
      advance,
      entry: stages[0],
      buffer: to.head,
    };
  }

  private startMix(
    from: AnalyzedTrack,
    plan: TransitionPlan,
    to: AnalyzedTrack | undefined,
  ) {
    const context = this.context;
    const video = this.video;
    const next = this.next;
    if (!context || !video || !next) return;

    // Start our copy exactly where the player's audio is: from what it
    // played at a known context time, not from its currentTime
    const setupFrom = performance.now();
    const heard = this.measurePlayerOffset(video, from);
    const startAt = context.currentTime + START_LEAD;
    const startOffset = heard
      ? heard.position + ((startAt - heard.at) * video.playbackRate)
      : this.songTime(video) + this.playerOffset + (START_LEAD * video.playbackRate);
    const offsetInTail = startOffset - from.tailStart;
    if (offsetInTail < 0 || plan.mixOut <= startOffset) {
      this.plan = null;
      return;
    }

    // Only when the tempos are too far apart for the new song alone, a
    // blend's tempo change is split between both songs: each moves half way.
    // Otherwise the old song is left alone (slowing it down or speeding it
    // up as the transition starts can be heard)
    const pair = `${from.videoId}>${next.videoId}`;
    const outStretch = this.stretchOut;
    const needsSplit =
      Math.abs(plan.rate - 1) > this.config.maxStretch + 1e-6;
    // A stretched blend glides both songs towards each other while they
    // overlap (see blendGlide), so neither changes speed while heard alone.
    // Not when the old song plays out at full volume to its final hit
    const glideMixAt = startAt + (plan.mixOut - startOffset);
    const glide =
      plan.style === 'blend' &&
      !plan.holdOutgoing &&
      Math.abs(plan.rate - 1) >= 0.001 &&
      Boolean(outStretch && this.stretch) &&
      to?.videoId === next.videoId &&
      glideMixAt - startAt >= OUT_HANDOFF + 0.2;
    const split =
      !glide &&
      needsSplit &&
      plan.style === 'blend' &&
      Boolean(outStretch && this.stretch) &&
      to?.videoId === next.videoId;
    const refuseSplit = () => {
      // Too far apart for one song alone: plan this pair again without it
      this.noSplitFor = pair;
      this.plan = null;
      this.planKey = '';
    };
    if (needsSplit && !split && !glide) {
      refuseSplit();
      return;
    }
    const outRate = split ? 1 / Math.sqrt(plan.rate) : 1;
    // The plan in real seconds once the old song runs at outRate, with the
    // new song at its half of the stretch
    const timed: TransitionPlan = split
      ? {
          ...plan,
          rate: Math.sqrt(plan.rate),
          duration: plan.duration / outRate,
          beat: plan.beat / outRate,
        }
      : plan;

    // The old song's tempo over time: 1x at the hand-off, then a glide to
    // outRate shortly after the stretched copy has taken over
    const outSteps: RateStep[] = [{ at: startAt, rate: 1 }];
    if (glide) {
      for (const step of blendGlide(
        glideMixAt,
        glideMixAt + plan.duration,
        plan.rate,
      )) {
        outSteps.push({ at: step.at, rate: step.rate / plan.rate });
      }
    } else if (split) {
      const glideFrom = startAt + OUT_HANDOFF + 0.1;
      for (let t = GLIDE_STEP / 2; t <= OUT_GLIDE_SECONDS; t += GLIDE_STEP / 2) {
        const x = t / OUT_GLIDE_SECONDS;
        const eased = x * x * (3 - (2 * x));
        outSteps.push({
          at: glideFrom + t - (GLIDE_STEP / 2),
          rate: 1 + ((outRate - 1) * eased),
        });
      }
    }
    const outPosition = (time: number) => {
      let at = startAt;
      let pos = startOffset;
      for (let i = 0; i < outSteps.length; i++) {
        const until = Math.min(time, outSteps[i + 1]?.at ?? time);
        pos += outSteps[i].rate * (until - at);
        at = until;
        if (until >= time) break;
      }
      return pos;
    };
    const glided = outSteps[outSteps.length - 1];
    if (split && plan.mixOut - outPosition(glided.at) < 0.5) {
      // No room to glide before the mix point
      refuseSplit();
      return;
    }

    const baseVolume = video.volume;
    const chain = this.buildOutgoing(context, from, timed);
    chain.master.gain.value = video.muted ? 0 : baseVolume;
    chain.source.start(startAt, offsetInTail);
    // Same audio, lined up to the sample: switch over in one go. The player
    // is silenced in this same task, once the mix is registered (below)
    chain.dry.gain.setValueAtTime(0, startAt);
    chain.dry.gain.setValueAtTime(1, startAt);

    // When the old song reaches its mix point, at the tempo it runs at
    const mixAt = split
      ? glided.at + ((plan.mixOut - outPosition(glided.at)) / outRate)
      : glideMixAt;
    const mixEnd =
      mixAt +
      (plan.style === 'cut'
        ? 0.05
        : timed.duration + (plan.holdOutgoing ? ENDING_RING : 0));

    let head: IncomingHead | undefined;
    let dressed = timed;
    try {
      this.scheduleOutgoing(context, chain, timed, mixAt, {
        position: outPosition,
        rate: (time) => {
          let current = 1;
          for (const step of outSteps) if (step.at <= time) current = step.rate;
          return current;
        },
        beat: plan.beat || 0.5,
        tailStart: from.tailStart,
      });
      // Play the incoming start from our own copy too, sample accurately
      head =
        to && to.videoId === next.videoId
          ? this.buildIncomingHead(
              context,
              to,
              timed,
              mixAt,
              mixEnd,
              video.muted ? 0 : baseVolume,
              glide,
            )
          : undefined;
      if ((split || glide) && !head) {
        throw new Error('no stretched copy to split with');
      }
      if (!head && chain.fx) {
        // An effect style needs our copy of the new song to filter, which
        // isn't there: a plain equal-power blend instead
        for (const [name, param] of Object.entries(chain.fx)) {
          param.cancelScheduledValues(mixAt);
          param.setValueAtTime(EFFECT_DEFAULTS[name as EffectParam], mixAt);
        }
        if (chain.repeat) {
          chain.repeat.song.gain.cancelScheduledValues(mixAt);
          for (const loop of chain.repeat.loops) loop.stop();
        }
        chain.dry.gain.cancelScheduledValues(mixAt);
        chain.dry.gain.setValueCurveAtTime(equalPowerOut, mixAt, timed.duration);
        dressed = { ...timed, effect: undefined };
      }
    } catch (error) {
      if (this.debugEnabled()) {
        console.warn('[AutoMix] transition refused:', error);
      }
      // Web Audio refused some automation: don't leave our copy playing
      // over the player, which hasn't been touched yet
      chain.source.stop();
      for (const node of chain.nodes) node.disconnect();
      if (split || glide) {
        refuseSplit();
        return;
      }
      throw error;
    }
    if (head) {
      chain.nodes.push(head.gain, head.master);
      if (head.source instanceof AudioBufferSourceNode) {
        chain.nodes.push(head.source);
      } else {
        chain.shared.push([head.source, head.entry]);
      }
    }

    // The stretched copy of the old song takes over from the plain one once
    // it has settled (same audio, in step), then glides to the shared tempo
    let outAdvance: ActiveMix['outAdvance'];
    if ((split || glide) && outStretch) {
      const channels = Array.from(
        { length: from.tail.numberOfChannels },
        (_, c) => from.tail.getChannelData(c).slice(),
      );
      Promise.all([
        outStretch.dropBuffers(),
        outStretch.addBuffers(
          channels,
          channels.map((channel) => channel.buffer),
        ),
        outStretch.schedule({
          outputTime: context.currentTime,
          output: startAt,
          active: true,
          input: startOffset - from.tailStart,
          rate: 1,
        }),
      ]).catch(() => {});
      const stretchedGain = context.createGain();
      stretchedGain.gain.value = 0;
      outStretch.connect(stretchedGain).connect(chain.input);
      const handoff = startAt + OUT_HANDOFF;
      chain.sourceGain.gain.setValueAtTime(1, handoff);
      chain.sourceGain.gain.linearRampToValueAtTime(0, handoff + 0.03);
      stretchedGain.gain.setValueAtTime(0, handoff);
      stretchedGain.gain.linearRampToValueAtTime(1, handoff + 0.03);
      // Last stop call wins: the plain copy is done after the hand-off
      chain.source.stop(handoff + 0.1);
      chain.nodes.push(stretchedGain);
      chain.shared.push([outStretch, stretchedGain]);

      // The stretcher keeps only one change ahead: send each step once the
      // one before it has started, then stop it once the blend is over
      let sent = 1;
      let stopped = false;
      outAdvance = (now) => {
        while (sent < outSteps.length && now >= outSteps[sent - 1].at) {
          outStretch
            .schedule({
              outputTime: outSteps[sent - 1].at + 0.001,
              output: outSteps[sent].at,
              rate: outSteps[sent].rate,
            })
            .catch(() => {});
          sent++;
        }
        if (!stopped && sent >= outSteps.length && now >= glided.at) {
          // Done gliding; the old song has faded out by the blend's end
          stopped = true;
          outStretch.stop(mixEnd + 0.1).catch(() => {});
        }
      };
    }

    const mix: ActiveMix = {
      plan: dressed,
      fromId: from.videoId,
      toId: next.videoId,
      fromTitle: this.currentTitle,
      toTitle: next.title,
      fromArt: this.currentArt,
      toArt: next.art,
      chain,
      startAt,
      mixAt,
      endAt: mixEnd,
      switched: false,
      cutDone: false,
      head,
      outStretch: split || glide ? (outStretch ?? undefined) : undefined,
      outAdvance,
      outRate: (time) => {
        let current = 1;
        for (const step of outSteps) if (step.at <= time) current = step.rate;
        return current;
      },
      outPosition,
      lockedTicks: 0,
      heardInSync: false,
      earWorks: false,
      earSeeks: 0,
      hearAfter: 0,
      sawIncoming: false,
      deferrals: 0,
      // Only push a blend back while the old song is still playing music
      outgoingEnd: Math.min(
        from.tailStart + from.tail.duration,
        from.analysis.trailingSilenceStart + plan.beat,
      ),
      follow: true,
      seeded: false,
      pendingSeeks: 0,
      error: 0,
      baseVolume,
      level: 0,
      handoffVolume: baseVolume,
      handoffSliderVolume: this.sliderVolume(),
      masterTarget: chain.master.gain.value,
      lastRate: 1,
      rateFights: 0,
      rateLocked: false,
      timers: [],
    };

    if (this.debugEnabled()) {
      console.log(
        '[AutoMix debug] mix:',
        plan.style,
        `${(Math.abs(plan.rate - 1) * 100).toFixed(1)}% tempo gap`,
        glide
          ? `glide: old song x1 -> x${(1 / plan.rate).toFixed(3)}, new song x${plan.rate.toFixed(3)} -> x1`
          : split
            ? `split: old song x${outRate.toFixed(3)}, new song x${timed.rate.toFixed(3)}`
            : `new song x${plan.rate.toFixed(3)}`,
        `| mix point in ${(mixAt - startAt).toFixed(2)}s`,
        `| out at ${plan.mixOut.toFixed(2)}s, in at ${plan.mixIn.toFixed(2)}s for ${plan.duration.toFixed(2)}s`,
        `| effect: ${effectName(dressed.effect) ?? 'none'}`,
        `| set up in ${(performance.now() - setupFrom).toFixed(0)} ms (lead ${START_LEAD * 1000} ms)`,
      );
    }
    // Registered first, so abort() can always undo what follows
    this.mix = mix;
    // From the copy's first sample the player is cancelled out, so it doesn't
    // matter when muting the element actually takes effect, as long as it's
    // not before the copy starts
    if (this.source) {
      const cancel = context.createGain();
      cancel.gain.value = 0;
      cancel.gain.setValueAtTime(-1, startAt);
      this.source.connect(cancel).connect(context.destination);
      mix.cancel = cancel;
    }
    this.at(startAt, () => {
      if (this.mix !== mix) return;
      this.holdVolume(video, mix);
      this.applyLevel(video, mix);
      if (!head && mix.cancel) {
        // The player itself brings the next song in: stop cancelling it
        // once it's muted, which is now (a volume change is heard within
        // ~10 ms), not at a fixed time: the main thread can be held up
        // for hundreds of ms here and the player would be heard twice
        const from = Math.max(context.currentTime, startAt) + 0.03;
        mix.cancel.gain.setValueAtTime(-1, from);
        mix.cancel.gain.linearRampToValueAtTime(0, from + 0.02);
      }
    });
    // The player moves on to the next song while we keep the old one playing
    this.at(startAt + 0.2, () => {
      if (!this.mix) return;
      this.mix.switched = true;
      this.skipToNext();
    });

    this.emitMix();
  }

  /** Touches every memory page of a buffer so it's resident again */
  private warm(buffer: AudioBuffer) {
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const data = buffer.getChannelData(c);
      // One float per 4 KB page
      for (let i = 0; i < data.length; i += 1024) this.warmSink += data[i];
    }
  }

  /** Same path as the user pressing Next, so the queue follows along */
  private skipToNext() {
    const button = document.querySelector<HTMLElement>(
      'ytmusic-player-bar .next-button',
    );
    if (button) button.click();
    else this.api.nextVideo();
  }

  private sliderVolume() {
    try {
      return this.api.getVolume();
    } catch {
      return 100;
    }
  }

  private setIncomingLevel(level: number) {
    const mix = this.mix;
    const video = this.video;
    if (!mix || !video) return;
    mix.level = level;
    this.applyLevel(video, mix);
  }

  private applyLevel(video: HTMLMediaElement, mix: ActiveMix) {
    // Never fully 0: Chromium handles a silent element differently and its
    // timing jumps by ~45 ms when sound resumes, which would knock the
    // incoming song off the beat. 1e-4 is -80 dB, i.e. inaudible.
    const volume = clamp(mix.baseVolume * mix.level, SILENT_VOLUME, 1);
    if (Math.abs(realVolume(video) - volume) > SILENT_VOLUME / 2) {
      setRealVolume(video, volume);
    }
  }

  /**
   * While mixing, the player's volume is AutoMix's: what YouTube Music sets
   * (the volume slider, or loudness normalisation when the next song loads)
   * becomes the level to mix at, instead of unmuting the player mid-mix
   */
  private holdVolume(video: HTMLMediaElement, mix: ActiveMix) {
    Object.defineProperty(video, 'volume', {
      configurable: true,
      get: () => mix.baseVolume,
      set: (volume: number) => {
        mix.baseVolume = clamp(volume, 0, 1);
        if (this.mix === mix) this.applyLevel(video, mix);
      },
    });
  }

  private releaseVolume(mix: ActiveMix) {
    const video = this.video;
    if (!video) return;
    Reflect.deleteProperty(video, 'volume');
    setRealVolume(video, mix.baseVolume);
  }

  private setRate(rate: number) {
    const mix = this.mix;
    const video = this.video;
    if (!mix || !video || mix.rateLocked) return;
    // Someone else (e.g. the playback speed plugin) keeps resetting the rate
    if (Math.abs(video.playbackRate - mix.lastRate) > 0.001) {
      mix.rateFights++;
      if (mix.rateFights > 3) {
        mix.rateLocked = true;
        return;
      }
    } else {
      mix.rateFights = 0;
    }
    const rounded = Math.round(rate * 1000) / 1000;
    if (Math.abs(video.playbackRate - rounded) > 0.0005) {
      video.preservesPitch = true;
      video.playbackRate = rounded;
    }
    mix.lastRate = rounded;
  }

  private seekIncoming(time: number) {
    const mix = this.mix;
    const video = this.video;
    if (!mix || !video) return;
    mix.pendingSeeks++;
    video.currentTime = Math.max(0, time) + this.timelineOffset(video);
  }

  private readonly onSeeking = () => {
    const mix = this.mix;
    if (!mix) {
      // Plan again from the new position
      this.planKey = '';
      return;
    }
    if (mix.pendingSeeks > 0) {
      mix.pendingSeeks--;
      return;
    }
    // The user scrubbed the song we were mixing: get out of the way
    if (!mix.switched || mix.seeded) this.cancel();
  };

  private readonly onPause = () => {
    const mix = this.mix;
    if (mix && (!mix.switched || mix.seeded)) this.cancel();
  };

  /**
   * Seeking or changing the song while a mix plays cancels it on the spot.
   * The player's own events can't tell our seeks / skips from the user's in
   * every case, so watch the controls the user actually touches as well.
   */
  private readonly onUserInput = (event: Event) => {
    if (!this.mix) return;
    const target = event.target instanceof Element ? event.target : null;

    if (event instanceof KeyboardEvent) {
      if (
        target?.closest('input, textarea, [contenteditable="true"]') ||
        !SEEK_AND_SKIP_KEYS.has(event.key)
      ) {
        return;
      }
      this.cancel();
      return;
    }

    if (target?.closest(SEEK_AND_SKIP_CONTROLS)) this.cancel();
  };

  private cancel() {
    if (!this.mix) return;
    this.abort();
  }

  /**
   * Wanted vs actual levels, 5x a second while mixing. Opt in from the
   * DevTools console: localStorage.setItem('automix-debug', '1')
   */
  private debugEnabled() {
    try {
      return localStorage.getItem(DEBUG_KEY) === '1';
    } catch {
      return false;
    }
  }

  private debugLevels(mix: ActiveMix, video: HTMLVideoElement, now: number) {
    if (now - this.lastDebug < 0.2 || !this.debugEnabled()) return;
    this.lastDebug = now;
    const want = clamp(mix.baseVolume * mix.level, SILENT_VOLUME, 1);
    const { chain, head } = mix;
    console.log(
      '[AutoMix debug]',
      `t=${(now - mix.mixAt).toFixed(2)}s from mix point`,
      `| player want=${want.toFixed(4)} real=${realVolume(video).toFixed(4)}`,
      `rate=${video.playbackRate.toFixed(3)}`,
      `| old song copy=${(chain.dry.gain.value * chain.master.gain.value).toFixed(3)}`,
      `| new song copy=${
        head ? (head.gain.gain.value * head.master.gain.value).toFixed(3) : '-'
      }`,
      `| heard tempo: old x${(mix.outRate?.(now) ?? 1).toFixed(3)} new x${(
        head?.rate(now) ?? video.playbackRate
      ).toFixed(3)}`,
      `| sync err=${(
        (this.songTime(video) + this.playerOffset - this.targetPosition(mix, now)) *
        1000
      ).toFixed(1)}ms avg=${(mix.error * 1000).toFixed(1)}ms locked=${mix.lockedTicks}`,
      `| heard ${
        mix.heardError === undefined
          ? '-'
          : `${(mix.heardError * 1000).toFixed(1)}ms`
      } seeks=${mix.earSeeks}`,
    );
  }

  /** Incoming track position we want at context time `now` */
  private targetPosition(mix: ActiveMix, now: number) {
    if (mix.head) return mix.head.position(now);
    return mix.plan.mixIn + (mix.plan.rate * (now - mix.mixAt));
  }

  /** The rate the player has to run at to stay with the incoming song */
  private targetRate(mix: ActiveMix, now: number) {
    return mix.head ? mix.head.rate(now) : mix.plan.rate;
  }

  private tickMix() {
    const mix = this.mix;
    const context = this.context;
    const video = this.video;
    if (!mix || !context || !video) return;

    const now = context.currentTime;
    mix.outAdvance?.(now);
    this.debugLevels(mix, video, now);

    // Keep the outgoing copy in step with the volume slider / mute button
    const slider = this.sliderVolume();
    const sliderRatio =
      mix.handoffSliderVolume > 0 ? slider / mix.handoffSliderVolume : 1;
    const masterTarget = video.muted
      ? 0
      : clamp(mix.handoffVolume * sliderRatio, 0, 1);
    if (Math.abs(masterTarget - mix.masterTarget) > 0.001) {
      mix.masterTarget = masterTarget;
      mix.chain.master.gain.setTargetAtTime(masterTarget, now, 0.05);
    }

    if (!mix.switched) {
      // Changed the song before we even skipped: the mix is off
      const id = this.currentVideoId();
      if (id && id !== mix.fromId) {
        this.cancel();
        return;
      }
      // Our copy is playing: keep the player itself silent
      if (now >= mix.startAt + 0.015) this.setIncomingLevel(0);
      this.emitMix();
      return;
    }

    if (mix.head) {
      const headTarget = video.muted ? 0 : mix.baseVolume;
      if (Math.abs(headTarget - mix.head.masterTarget) > 0.001) {
        mix.head.masterTarget = headTarget;
        mix.head.master.gain.setTargetAtTime(headTarget, now, 0.05);
      }
    }

    const id = this.currentVideoId();
    if (id === mix.toId) mix.sawIncoming = true;
    if (id && id !== mix.toId && (id !== mix.fromId || mix.sawIncoming)) {
      if (!mix.sawIncoming && readQueue(mix.fromId)?.next?.videoId === id) {
        // The queue changed under our skip: fade into the song that came up
        mix.toId = id;
        mix.sawIncoming = true;
        this.fallBackToFade(mix, now);
      } else {
        // The user (or a media key) changed the song: step aside
        this.cancel();
        return;
      }
    }

    if (mix.settleAt !== undefined) {
      this.tickSettle(mix, now);
      return;
    }

    const incomingPlaying =
      id === mix.toId && video.readyState >= 3 && !video.seeking;

    if (mix.head && !incomingPlaying) {
      // Nothing worth hearing until it plays again for a full listen
      mix.hearAfter = Math.max(mix.hearAfter, now + HEAR_SECONDS + 0.15);
    }

    const byEar = () =>
      mix.head &&
      mix.seeded &&
      now >= mix.head.handOverFrom &&
      this.followByEar(mix, mix.head, video, now, this.targetRate(mix, now));

    if (incomingPlaying && mix.follow && !byEar()) {
      const target = this.targetPosition(mix, now);
      const rate = this.targetRate(mix, now);
      if (target < 0) {
        // Too early for the incoming song: hold it at the very start
        if (this.songTime(video) > 0.25) this.seekIncoming(0);
        this.setRate(0.0625);
      } else {
        // Compare what's actually heard, not the player's reported position
        const error = this.songTime(video) + this.playerOffset - target;
        if (!mix.seeded || Math.abs(error) > 0.25) {
          this.seekIncoming(
            target - this.playerOffset + (SEEK_LATENCY * rate),
          );
          this.setRate(rate);
          mix.seeded = true;
          mix.error = 0;
        } else {
          // Phase lock: nudge the tempo until the beats sit on top of each other
          mix.error = (mix.error * 0.7) + (error * 0.3);
          // Pull it in only while the player is silent. Every rate change
          // makes Chrome's audio jump ~25 ms, so once it's heard it holds
          // the copy's rate (a few ms of drift is far less audible)
          const silent = now < mix.mixAt || Boolean(mix.head);
          // Close enough: run at exactly the copy's rate. Behind our copy it
          // can get closer for the hand-over (its timing jitters ~1 ms)
          const deadband = mix.head ? 0.003 : 0.006;
          this.setRate(
            !silent || Math.abs(mix.error) < deadband
              ? rate
              : rate * (1 - clamp(mix.error * 2.5, -0.1, 0.1)),
          );
          // Only count as in sync while steady at that rate. Within the
          // deadband nothing pulls the error lower, so a stricter test
          // would flicker on and off and hold the hand-over up
          mix.lockedTicks =
            Math.abs(error) < deadband + 0.004 &&
            Math.abs(mix.error) < deadband &&
            Math.abs(video.playbackRate - rate) < 0.0005
              ? mix.lockedTicks + 1
              : 0;
        }
      }
    }

    if (mix.head) {
      this.tickHead(mix, mix.head, now, incomingPlaying);
      return;
    }

    // The next song isn't in step yet (the player was slow to load it):
    // keep the old song going and start the blend a bar later instead of
    // bringing the new one in off the beat
    if (
      mix.plan.style === 'blend' &&
      !mix.plan.holdOutgoing &&
      now >= mix.mixAt - 0.3 &&
      now < mix.mixAt &&
      mix.lockedTicks < 5
    ) {
      this.deferMix(mix, now);
    }

    // Incoming level
    if (mix.plan.style === 'cut' || mix.plan.style === 'segue') {
      const dropped = incomingPlaying && (mix.cutDone || now >= mix.mixAt);
      this.setIncomingLevel(dropped ? 1 : 0);
      if (!dropped && incomingPlaying && mix.mixAt - now < 0.05) {
        // Land the cut on the exact beat rather than on the next tick
        this.at(mix.mixAt, () => {
          if (this.mix !== mix) return;
          mix.cutDone = true;
          this.setIncomingLevel(1);
        });
      }
    } else {
      this.setIncomingLevel(
        incomingPlaying ? this.incomingLevel(mix, now) : 0,
      );
    }

    if (now >= mix.endAt && incomingPlaying) {
      this.setIncomingLevel(1);
      mix.settleAt = now;
      mix.settleFrom = video.playbackRate;
    } else if (now >= mix.endAt + 3) {
      // The next song never showed up; don't keep the player muted
      this.abort();
      return;
    }

    this.emitMix();
  }

  /**
   * While our copy of the incoming song plays, keep the player silent and
   * following along; once the mix is over and the player is in sync, cross
   * over to it (same audio, so the switch is inaudible).
   */
  private tickHead(
    mix: ActiveMix,
    head: IncomingHead,
    now: number,
    incomingPlaying: boolean,
  ) {
    head.advance?.(now);
    this.setIncomingLevel(0);

    // Hand the song to the player (full quality) as soon as our copy has
    // nothing left to do that the player can't: once any filter has opened
    // and a stretched copy is back to normal speed
    const canHandOver = now >= head.handOverFrom;
    const synced = mix.earWorks
      ? mix.heardInSync
      : mix.lockedTicks >= 8 &&
        (!this.tap || now >= head.handOverFrom + EAR_GRACE);
    const runningOut = now >= head.endAt - 1.5;
    if (canHandOver && incomingPlaying && (synced || runningOut)) {
      this.handOver(mix, head, now);
    } else if (now >= head.endAt - 0.2) {
      // The player never caught up: don't leave it muted
      this.abort();
      return;
    }
    this.emitMix();
  }

  private deferMix(mix: ActiveMix, now: number) {
    const context = this.context;
    const bar = (mix.plan.beat || 0.5) * 4;
    if (
      !context ||
      mix.deferrals >= MAX_DEFERRALS ||
      mix.plan.mixOut + bar + mix.plan.duration > mix.outgoingEnd
    ) {
      return;
    }

    const { chain } = mix;
    for (const param of [
      chain.dry.gain,
      chain.lowShelf?.gain,
      chain.highpass?.frequency,
      chain.lowpass?.frequency,
    ]) {
      if (!param) continue;
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
    }

    mix.deferrals++;
    mix.mixAt += bar;
    mix.endAt += bar;
    mix.plan = { ...mix.plan, mixOut: mix.plan.mixOut + bar };
    this.scheduleOutgoing(context, chain, mix.plan, mix.mixAt);
  }

  /** How loud the incoming song should be at context time `time` */
  private incomingLevel(mix: ActiveMix, time: number) {
    if (mix.plan.style === 'cut' || mix.plan.style === 'segue') {
      return time >= mix.mixAt ? 1 : 0;
    }
    const progress = (time - mix.mixAt) / mix.plan.duration;
    if (progress <= 0) return 0;
    if (progress >= 1) return 1;
    return Math.sin((progress * Math.PI) / 2);
  }

  private handOver(mix: ActiveMix, head: IncomingHead, now: number) {
    if (this.debugEnabled()) {
      console.log(
        '[AutoMix debug] hand-over',
        `t=${(now - mix.mixAt).toFixed(2)}s from mix point`,
        mix.earWorks
          ? `heard ${((mix.heardError ?? 0) * 1000).toFixed(1)}ms after ${mix.earSeeks} seeks`
          : `unheard, locked=${mix.lockedTicks}`,
      );
    }
    // Our copy plays at normal speed by now; make sure the player does too
    this.setRate(1);

    // Unmute the player first, while it's still cancelled out; once that
    // has surely landed, fade our copy and the cancelling out together.
    // Same audio, in sync: the sum stays the same throughout
    const at = now + 0.02;
    const level = this.incomingLevel(mix, at);
    this.setIncomingLevel(level);
    head.gain.gain.cancelScheduledValues(at);
    head.gain.gain.setValueAtTime(level, at);
    head.gain.gain.linearRampToValueAtTime(0, at + 0.005);
    head.source.stop(at + 0.05);
    if (mix.cancel) {
      mix.cancel.gain.cancelScheduledValues(at);
      mix.cancel.gain.setValueAtTime(-1, at);
      mix.cancel.gain.linearRampToValueAtTime(0, at + 0.005);
    }

    // The player carries on with the rest of the fade-in itself
    mix.head = undefined;
    // Nothing to stay locked to any more (the old song is only a fading
    // tail), and nudging the now audible player's speed would be heard
    mix.follow = false;
  }

  /** Glide the incoming song back to its own tempo after the mix */
  private tickSettle(mix: ActiveMix, now: number) {
    const from = mix.settleFrom ?? 1;
    const elapsed = now - (mix.settleAt ?? now);
    if (Math.abs(from - 1) < 0.002 || elapsed >= SETTLE_SECONDS) {
      this.setRate(1);
      this.finish();
      return;
    }
    const t = elapsed / SETTLE_SECONDS;
    const eased = t * t * (3 - (2 * t));
    this.setRate(from + ((1 - from) * eased));
    this.emitMix();
  }

  /** Replace whatever is scheduled with a plain fade starting now */
  private fallBackToFade(mix: ActiveMix, now: number) {
    const { chain } = mix;
    if (mix.head) {
      // Our copy is of the song we planned, not the one that came up
      mix.head.gain.gain.cancelScheduledValues(now);
      mix.head.gain.gain.setTargetAtTime(0, now, 0.03);
      mix.head.source.stop(now + 0.2);
      mix.head = undefined;
    }
    this.stopCancelling(mix, now);
    const start = Math.max(now, mix.mixAt);
    const remaining = Math.max(1.5, Math.min(6, mix.endAt - start));
    for (const node of chain.nodes) {
      if (node instanceof BiquadFilterNode) {
        node.frequency.cancelScheduledValues(now);
        node.gain.cancelScheduledValues(now);
      }
    }
    chain.dry.gain.cancelScheduledValues(now);
    chain.dry.gain.setValueAtTime(chain.dry.gain.value, now);
    chain.dry.gain.setValueAtTime(chain.dry.gain.value, start);
    chain.dry.gain.linearRampToValueAtTime(0, start + remaining);
    try {
      chain.source.stop(start + remaining + 0.1);
    } catch {
      // Already scheduled to stop
    }

    mix.plan = {
      ...mix.plan,
      style: 'smooth',
      reason: 'fallback',
      rate: 1,
      duration: remaining,
    };
    mix.mixAt = start;
    mix.endAt = start + remaining;
    mix.follow = false;
    this.setRate(1);
  }

  private emitMix() {
    const mix = this.mix;
    if (!mix || !this.context) return;
    const progress = clamp(
      (this.context.currentTime - mix.mixAt) / (mix.endAt - mix.mixAt),
      0,
      1,
    );
    this.emit({
      phase: 'mixing',
      plan: mix.plan,
      fromTitle: mix.fromTitle,
      toTitle: mix.toTitle,
      fromArt: mix.fromArt,
      toArt: mix.toArt,
      progress,
    });
  }

  private cleanup(mix: ActiveMix, fadeSeconds: number) {
    const context = this.context;
    for (const timer of mix.timers) window.clearTimeout(timer);
    mix.timers = [];
    this.releaseVolume(mix);
    if (!context) return;

    const now = context.currentTime;
    this.stopCancelling(mix, now);
    mix.outAdvance = undefined;
    mix.outStretch?.stop(now + fadeSeconds).catch(() => {});
    mix.chain.dry.gain.cancelScheduledValues(now);
    mix.chain.dry.gain.setTargetAtTime(0, now, fadeSeconds / 4);
    try {
      mix.chain.source.stop(now + fadeSeconds);
    } catch {
      // Already stopped
    }
    if (mix.head) {
      mix.head.gain.gain.cancelScheduledValues(now);
      mix.head.gain.gain.setTargetAtTime(0, now, fadeSeconds / 4);
      try {
        mix.head.source.stop(now + fadeSeconds);
      } catch {
        // Already stopped
      }
    }
    // Let echo tails and any ending ring out before tearing the graph down
    window.setTimeout(
      () => {
        for (const node of mix.chain.nodes) node.disconnect();
        for (const [node, target] of mix.chain.shared) {
          try {
            node.disconnect(target);
          } catch {
            // Already disconnected
          }
        }
        if (mix.cancel) {
          mix.cancel.disconnect();
          try {
            this.source?.disconnect(mix.cancel);
          } catch {
            // The player's source changed meanwhile
          }
        }
      },
      (fadeSeconds + 6) * 1000,
    );
  }

  /** Let the player be heard again (it's fading back in on its own) */
  private stopCancelling(mix: ActiveMix, now: number) {
    if (!mix.cancel) return;
    mix.cancel.gain.cancelScheduledValues(now);
    mix.cancel.gain.setTargetAtTime(0, now, 0.01);
  }

  /** A mix only starts at normal speed, so always hand that back */
  private restoreRate() {
    const video = this.video;
    if (video && Math.abs(video.playbackRate - 1) > 0.0005) {
      video.playbackRate = 1;
    }
  }

  private finish() {
    const mix = this.mix;
    if (!mix) return;
    this.cleanup(mix, 0.2);
    this.restoreRate();
    this.mix = null;
    this.plan = null;
    this.planKey = '';
    this.currentId = null;
    this.schedule(0);
  }

  private abort() {
    const mix = this.mix;
    if (!mix) return;
    this.cleanup(mix, 0.3);
    this.restoreRate();
    this.mix = null;
    this.plan = null;
    this.planKey = '';
    this.currentId = null;
    this.schedule(IDLE_TICK_MS);
  }
}
