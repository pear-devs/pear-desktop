import {
  emptySection,
  sectionFromBeats,
  type TrackAnalysis,
} from './analysis';
import {
  decodeAndAnalyze,
  resampleForAi,
  type AnalyzedTrack,
} from './decoder';
import { planTransition, type TransitionPlan } from './planner';
import { getQueueStore, readQueue, type QueueTrack } from './queue';

import type { AiBeatTracker } from './ai';
import type { AutoMixPluginConfig } from './config';
import type { FetchedAudio } from './constants';
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
  /** 0..1 progress of the audible blend (mixing only) */
  progress?: number;
  /** AI beat tracker state, when the setting is on */
  ai?: AiState;
  /** Where the AI model runs ("webgpu" or "wasm") */
  aiProvider?: string;
  /** Stream quality of AutoMix's copy, when it's noticeably worse */
  lowQuality?: string;
}

export type AiState = 'loading' | 'analysing' | 'ready' | 'failed';

interface EngineOptions {
  api: MusicPlayer;
  fetchAudio: (videoId: string) => Promise<FetchedAudio | null>;
  onStatus: (status: AutoMixStatus) => void;
}

interface OutgoingChain {
  source: AudioBufferSourceNode;
  dry: GainNode;
  master: GainNode;
  highpass?: BiquadFilterNode;
  lowShelf?: BiquadFilterNode;
  lowpass?: BiquadFilterNode;
  /** Last node before the dry gain (where an echo send taps in) */
  tap: AudioNode;
  nodes: AudioNode[];
}

/** AutoMix's own sample-accurate copy of the incoming song's start */
interface IncomingHead {
  source: AudioBufferSourceNode;
  gain: GainNode;
  master: GainNode;
  masterTarget: number;
  /** Context time at which the copy runs out */
  endAt: number;
}

interface ActiveMix {
  plan: TransitionPlan;
  fromId: string;
  toId: string;
  fromTitle: string;
  toTitle: string;
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
  /** Consecutive ticks the player has been in sync with our copy */
  lockedTicks: number;
  /** Crossfading from our copy to the player */
  handingOver: boolean;
  /** The player has been on the incoming song at least once */
  sawIncoming: boolean;
  /** Follow the beat grid (false once we fell back to a plain fade) */
  follow: boolean;
  seeded: boolean;
  pendingSeeks: number;
  error: number;
  /** Element volume YouTube Music wants (user volume × normalisation) */
  baseVolume: number;
  lastWrittenVolume: number;
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
/** Seconds of a song's end the AI beat tracker looks at */
const AI_SECTION_SECONDS = 45;
/** A song-length mismatch has to last this long to count (seeks re-buffer) */
const MISMATCH_GRACE_MS = 3000;
const RETRY_FAILED_MS = 120_000;
/** Media seek takes a moment before audio resumes */
const SEEK_LATENCY = 0.08;
/** Tempo glide back to normal after a blend: slow, so it isn't heard */
const SETTLE_SECONDS = 14;
const CROSSOVER_HZ = 180;
const SILENT_VOLUME = 0.0001;
/** How long the final hit of a song that stops on the beat rings out */
const ENDING_RING = 1.5;
/** Where the incoming song's high-pass starts when it's filtered in */
const FILTER_IN_HZ = 500;
/** Start a no-analysis fade plan this long before the song's audible end */
const LATE_PLAN_SECONDS = 25;

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

export class AutoMixEngine {
  private readonly api: MusicPlayer;
  private readonly fetchAudio: EngineOptions['fetchAudio'];
  private readonly onStatus: EngineOptions['onStatus'];

  private config: AutoMixPluginConfig;
  private context: AudioContext | null = null;

  private readonly tracks = new Map<string, Promise<AnalyzedTrack | null>>();
  /** Analyses refined by the AI beat tracker, per video id */
  private readonly aiAnalyses = new Map<string, TrackAnalysis>();
  private readonly aiFailed = new Set<string>();
  private ai: AiBeatTracker | null = null;
  private aiProvider: string | undefined;
  private aiLoadState: 'off' | 'loading' | 'ready' | 'failed' = 'off';
  private aiBusy: string | null = null;
  private readonly ready = new Map<string, AnalyzedTrack>();
  private readonly failedAt = new Map<string, number>();

  private currentId: string | null = null;
  private next: QueueTrack | null = null;
  private afterNext: QueueTrack | null = null;
  private queueStore: ReturnType<typeof getQueueStore> = undefined;
  private unsubscribeQueue: (() => void) | null = null;
  private currentTitle = '';
  private repeatOne = false;
  private sameAlbum = false;
  private lastQueueRead = 0;

  private plan: TransitionPlan | null = null;
  private planKey = '';
  private mix: ActiveMix | null = null;

  private timer: number | undefined;
  private stopped = false;
  private lastStatus = '';
  private lastSummary = '';

  constructor(options: EngineOptions, config: AutoMixPluginConfig) {
    this.api = options.api;
    this.fetchAudio = options.fetchAudio;
    this.onStatus = options.onStatus;
    this.config = config;

    document.addEventListener('peard:audio-can-play', this.onAudioCanPlay, {
      passive: true,
    });
    const video = this.video;
    video?.addEventListener('volumechange', this.onVolumeChange);
    video?.addEventListener('seeking', this.onSeeking);
    video?.addEventListener('pause', this.onPause);
    document.addEventListener('pointerdown', this.onUserInput, true);
    document.addEventListener('keydown', this.onUserInput, true);

    this.schedule(0);
  }

  setConfig(config: AutoMixPluginConfig) {
    this.config = config;
    if (!config.active && this.mix) this.abort();
    this.planKey = '';
    this.schedule(0);
  }

  /** The player creates its AudioContext before plugins are told about it */
  setAudioContext(context: AudioContext) {
    this.context = context;
  }

  destroy() {
    this.stopped = true;
    if (this.mix) this.abort();
    window.clearTimeout(this.timer);
    document.removeEventListener('peard:audio-can-play', this.onAudioCanPlay);
    const video = this.video;
    video?.removeEventListener('volumechange', this.onVolumeChange);
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
  };

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

    const summary = [status.phase, status.reason, status.plan?.style]
      .filter(Boolean)
      .join(' ');
    if (summary !== this.lastSummary) {
      this.lastSummary = summary;
      console.info('[AutoMix]', summary, status.plan ?? '');
    }

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
      return { ...track, quality: audio.quality, lowQuality: audio.lowQuality };
    })()
      .catch((error: unknown) => {
        console.warn('[AutoMix] analysis failed', videoId, error);
        return null;
      })
      .then((track) => {
        if (this.tracks.get(videoId) !== promise) return track;
        if (track) {
          this.ready.set(videoId, track);
          this.failedAt.delete(videoId);
        } else {
          this.tracks.delete(videoId);
          this.failedAt.set(videoId, Date.now());
        }
        this.schedule(0);
        return track;
      });
    this.tracks.set(videoId, promise);
  }

  private pruneTracks(keep: (string | null | undefined)[]) {
    for (const id of [...this.tracks.keys()]) {
      if (!keep.includes(id)) {
        this.tracks.delete(id);
        this.ready.delete(id);
      }
    }
    for (const id of [...this.aiAnalyses.keys()]) {
      if (!keep.includes(id)) this.aiAnalyses.delete(id);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Optional AI beat tracker                                            */
  /* ------------------------------------------------------------------ */

  setAi(tracker: AiBeatTracker | null, provider?: string) {
    this.ai = tracker;
    this.aiProvider = provider;
    this.aiLoadState = tracker ? 'ready' : 'off';
    this.aiFailed.clear();
    this.planKey = '';
    this.schedule(0);
  }

  setAiLoading(state: 'loading' | 'failed' | 'off') {
    this.aiLoadState = state;
    this.lastStatus = '';
    this.schedule(0);
  }

  /** The analysis to plan with: AI-refined beats when available */
  private analysisOf(track: AnalyzedTrack) {
    return (
      (this.config.aiBeats && this.aiAnalyses.get(track.videoId)) ||
      track.analysis
    );
  }

  private aiStatus(ids: (string | undefined)[]): Partial<AutoMixStatus> {
    if (!this.config.aiBeats) return {};
    if (this.aiLoadState === 'loading' || this.aiLoadState === 'failed') {
      return { ai: this.aiLoadState };
    }
    if (this.aiLoadState !== 'ready') return {};
    const [current, next] = ids;
    const sectionDone = (id: string | undefined, edge: 'start' | 'end') =>
      !id ||
      Boolean(this.aiAnalyses.get(id)?.[edge].ai) ||
      this.aiFailed.has(`${id}:${edge}`);
    const done = sectionDone(current, 'end') && sectionDone(next, 'start');
    return {
      ai: done ? 'ready' : 'analysing',
      aiProvider: this.aiProvider,
    };
  }

  /**
   * Refine one song section at a time, most urgent first: the end of the
   * current song and the start of the next one decide the coming mix.
   */
  private refineWithAi() {
    if (!this.ai || !this.config.aiBeats || this.aiBusy) return;

    const jobs: [string | undefined, 'start' | 'end'][] = [
      [this.mix?.toId, 'end'],
      [this.currentId ?? undefined, 'end'],
      [this.next?.videoId, 'start'],
      [this.next?.videoId, 'end'],
    ];
    const job = jobs.find(([id, edge]) => {
      if (!id || this.aiFailed.has(`${id}:${edge}`)) return false;
      const track = this.ready.get(id);
      return track && !this.aiAnalyses.get(id)?.[edge].ai;
    });
    if (!job) return;
    const [id, edge] = job as [string, 'start' | 'end'];
    const track = this.ready.get(id)!;

    const ai = this.ai;
    const busy = `${id}:${edge}`;
    this.aiBusy = busy;
    (async () => {
      const { analysis, head, tail, tailStart } = track;
      // The model only listens to the stretch we mix on
      let audio: Float32Array;
      let offset = 0;
      if (edge === 'start') {
        audio = await resampleForAi(head, 0, head.duration);
      } else {
        const from = Math.max(
          0,
          analysis.trailingSilenceStart - AI_SECTION_SECONDS - tailStart,
        );
        audio = await resampleForAi(tail, from, from + AI_SECTION_SECONDS + 0.5);
        offset = tailStart + from;
      }
      const found = await ai.analyze(audio);
      const base = this.aiAnalyses.get(id) ?? analysis;
      const section = sectionFromBeats(
        found.beats.map((time) => time + offset),
        found.downbeats.map((time) => time + offset),
        analysis[edge],
        edge,
      );
      if (!section) throw new Error('Too few beats found');
      return { ...base, [edge]: section };
    })()
      .then((refined) => {
        if (this.ai !== ai) return;
        this.aiAnalyses.set(id, refined);
        console.info(
          `[AutoMix] AI beats ready for the ${edge} of ${id}:`,
          `${refined[edge].bpm.toFixed(1)} BPM`,
        );
      })
      .catch((error: unknown) => {
        console.warn('[AutoMix] AI beat tracking failed', error);
        this.aiFailed.add(busy);
      })
      .finally(() => {
        this.aiBusy = null;
        this.schedule(0);
      });
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
    if (this.next && queue?.next?.videoId !== this.next.videoId) {
      console.info(
        '[AutoMix] next song changed:',
        queue?.next?.title ?? 'nothing',
      );
    }
    this.next = queue?.next ?? null;
    this.afterNext = queue?.afterNext ?? null;
    this.currentTitle = queue?.current?.title ?? this.currentTitle;
    this.repeatOne = queue?.repeatMode === 'ONE';
    this.sameAlbum = Boolean(
      queue?.current?.albumId && queue.current.albumId === queue.next?.albumId,
    );
  }

  private mismatchSince: number | null = null;

  private playingDuration(video: HTMLVideoElement) {
    try {
      const duration = this.api.getDuration();
      if (Number.isFinite(duration) && duration > 0) return duration;
    } catch {
      // Fall back to the element
    }
    return video.duration;
  }

  private isOtherVersion(video: HTMLVideoElement, from: AnalyzedTrack) {
    const duration = this.playingDuration(video);
    const differs =
      !video.seeking &&
      video.readyState >= 1 &&
      Number.isFinite(duration) &&
      duration > 0 &&
      Math.abs(duration - from.analysis.duration) > 2;
    if (!differs) {
      this.mismatchSince = null;
      return false;
    }
    this.mismatchSince ??= Date.now();
    return Date.now() - this.mismatchSince > MISMATCH_GRACE_MS;
  }

  private tickIdle(): number {
    const video = this.video;
    const id = this.currentVideoId();

    if (!this.config.active || !video || !id) {
      this.emit({ phase: 'inactive' });
      return IDLE_TICK_MS;
    }

    if (id !== this.currentId) {
      this.currentId = id;
      this.mismatchSince = null;
      this.currentTitle = this.api.getVideoData()?.title ?? '';
      this.plan = null;
      this.planKey = '';
      this.refreshQueue(true);
    } else {
      this.refreshQueue();
    }

    this.watchQueue();
    this.refineWithAi();

    const nextId = this.next?.videoId;
    const afterNextId = this.afterNext?.videoId;
    this.pruneTracks([id, nextId, afterNextId]);

    const blocked: AutoMixWaitReason | null =
      !nextId || nextId === id
        ? 'no-next'
        : this.repeatOne || video.loop
          ? 'repeat-one'
          : this.config.respectAlbums && this.sameAlbum
            ? 'same-album'
            : null;
    if (blocked || !nextId) {
      this.plan = null;
      this.emit({ phase: 'waiting', reason: blocked ?? 'no-next' });
      return IDLE_TICK_MS;
    }

    this.ensureTrack(id);
    this.ensureTrack(nextId);

    const from = this.ready.get(id);
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
      video.currentTime >
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

    const fromAnalysis = this.analysisOf(from);
    const toAnalysis = to ? this.analysisOf(to) : unknownTrack;
    const key = JSON.stringify([
      id,
      nextId,
      Boolean(to),
      Boolean(fromAnalysis.end.ai),
      Boolean(toAnalysis.start.ai),
      this.config,
    ]);
    const tooLate =
      this.plan &&
      video.currentTime > this.plan.mixOut - prerollFor(this.plan) + 0.5;
    if (key !== this.planKey || tooLate) {
      this.planKey = key;
      const plan = planTransition(fromAnalysis, toAnalysis, {
        preference: to ? this.config.transition : 'smooth',
        blendBeats: this.config.blendBeats,
        maxStretch: this.config.maxStretch,
        smoothSeconds: this.config.smoothSeconds,
        earliestMixOut: Math.max(video.currentTime + 6.5, from.tailStart + 6.5),
      });
      this.plan =
        plan && !to
          ? { ...plan, reason: 'late-change' }
          : plan && {
              ...plan,
              ai: Boolean(fromAnalysis.end.ai && toAnalysis.start.ai),
            };
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
      ...this.aiStatus([id, nextId]),
      lowQuality: [from, to]
        .filter((track) => track?.lowQuality)
        .map((track) => track?.quality)
        .join(', ') || undefined,
    });

    const remaining = plan.mixOut - prerollFor(plan) - video.currentTime;
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
    let tap: AudioNode = source;
    for (const node of filters) tap = tap.connect(node);
    tap.connect(dry).connect(master).connect(context.destination);

    return {
      source,
      dry,
      master,
      highpass,
      lowShelf,
      lowpass,
      tap,
      nodes: [source, ...filters, dry, master],
    };
  }

  /** Schedules the outgoing side of the transition, sample accurately */
  private scheduleOutgoing(
    context: AudioContext,
    chain: OutgoingChain,
    plan: TransitionPlan,
    mixAt: number,
  ) {
    const { dry, highpass, lowShelf, lowpass } = chain;
    const duration = plan.duration;

    switch (plan.style) {
      case 'blend': {
        if (plan.holdOutgoing) {
          // The old song keeps its full ending; bass swaps on its final hit,
          // which rings out briefly under the next song
          const hit = mixAt + duration;
          const beat = plan.beat || 0.5;
          lowShelf?.gain.setValueAtTime(0, hit - (beat / 2));
          lowShelf?.gain.linearRampToValueAtTime(-30, hit);
          dry.gain.setValueAtTime(1, hit + 0.05);
          dry.gain.setTargetAtTime(0, hit + 0.05, ENDING_RING / 4);
          chain.source.stop(hit + ENDING_RING + 0.2);
          break;
        }
        // Equal-power crossfade with a DJ style bass swap halfway through
        dry.gain.setValueCurveAtTime(equalPowerOut, mixAt, duration);
        lowShelf?.gain.setValueAtTime(0, mixAt + (duration * 0.45));
        lowShelf?.gain.linearRampToValueAtTime(-30, mixAt + (duration * 0.55));
        highpass?.frequency.setValueAtTime(20, mixAt + (duration * 0.55));
        highpass?.frequency.exponentialRampToValueAtTime(400, mixAt + duration);
        chain.source.stop(mixAt + duration + 0.1);
        break;
      }

      case 'cut': {
        // Filter build-up over the last bar, an echo throw, then a hard cut
        const beat = plan.beat || 0.5;
        const buildFrom = Math.max(context.currentTime, mixAt - (beat * 4));
        highpass?.frequency.setValueAtTime(20, buildFrom);
        highpass?.frequency.exponentialRampToValueAtTime(900, mixAt);

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
  private buildIncomingHead(
    context: AudioContext,
    to: AnalyzedTrack,
    plan: TransitionPlan,
    mixAt: number,
    volume: number,
  ): IncomingHead {
    const source = context.createBufferSource();
    source.buffer = to.head;
    const gain = context.createGain();
    gain.gain.value = 0;
    const master = context.createGain();
    master.gain.value = volume;
    if (plan.filterIn) {
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
      source.connect(highpass).connect(gain);
    } else {
      source.connect(gain);
    }
    gain.connect(master).connect(context.destination);

    if (plan.style === 'cut' || plan.style === 'segue') {
      // The incoming song starts as itself: no fade-in on its first note
      gain.gain.setValueAtTime(0, mixAt);
      gain.gain.linearRampToValueAtTime(1, mixAt + 0.004);
    } else {
      gain.gain.setValueCurveAtTime(equalPowerIn, mixAt, plan.duration);
    }
    source.start(mixAt, plan.mixIn);

    return {
      source,
      gain,
      master,
      masterTarget: volume,
      endAt: mixAt + (to.head.duration - plan.mixIn),
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

    const lead = 0.05;
    const startAt = context.currentTime + lead;
    const startOffset = video.currentTime + lead;
    const offsetInTail = startOffset - from.tailStart;
    if (offsetInTail < 0 || plan.mixOut <= startOffset) {
      this.plan = null;
      return;
    }

    const chain = this.buildOutgoing(context, from, plan);
    chain.master.gain.value = video.muted ? 0 : video.volume;
    chain.source.start(startAt, offsetInTail);
    chain.dry.gain.setValueAtTime(0, startAt);
    chain.dry.gain.linearRampToValueAtTime(1, startAt + 0.03);

    const mixAt = startAt + (plan.mixOut - startOffset);
    this.scheduleOutgoing(context, chain, plan, mixAt);

    // No time-stretch needed: play the incoming start from our own copy too,
    // as long as it covers the mix plus a few seconds to hand over
    const head =
      to &&
      to.videoId === next.videoId &&
      plan.style !== 'blend' &&
      Math.abs(plan.rate - 1) < 0.001 &&
      plan.mixIn + (plan.style === 'smooth' ? plan.duration : 0) + 6 <
        to.head.duration
        ? this.buildIncomingHead(
            context,
            to,
            plan,
            mixAt,
            video.muted ? 0 : video.volume,
          )
        : undefined;
    if (head) chain.nodes.push(head.source, head.gain, head.master);

    this.mix = {
      plan,
      fromId: from.videoId,
      toId: next.videoId,
      fromTitle: this.currentTitle,
      toTitle: next.title,
      chain,
      startAt,
      mixAt,
      endAt:
        mixAt +
        (plan.style === 'cut'
          ? 0.05
          : plan.duration + (plan.holdOutgoing ? ENDING_RING : 0)),
      switched: false,
      cutDone: false,
      head,
      lockedTicks: 0,
      handingOver: false,
      sawIncoming: false,
      follow: true,
      seeded: false,
      pendingSeeks: 0,
      error: 0,
      baseVolume: video.volume,
      lastWrittenVolume: video.volume,
      handoffVolume: video.volume,
      handoffSliderVolume: this.sliderVolume(),
      masterTarget: chain.master.gain.value,
      lastRate: 1,
      rateFights: 0,
      rateLocked: false,
      timers: [],
    };

    // The player goes quiet the instant our copy takes over…
    this.at(startAt + 0.015, () => this.setIncomingLevel(0));
    // …then moves on to the next song while we keep the old one playing
    this.at(startAt + 0.2, () => {
      if (!this.mix) return;
      this.mix.switched = true;
      this.skipToNext();
    });

    this.emitMix();
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
    // Never fully 0: Chromium handles a silent element differently and its
    // timing jumps by ~45 ms when sound resumes, which would knock the
    // incoming song off the beat. 1e-4 is -80 dB, i.e. inaudible.
    const volume = clamp(mix.baseVolume * level, SILENT_VOLUME, 1);
    mix.lastWrittenVolume = volume;
    if (Math.abs(video.volume - volume) > SILENT_VOLUME / 2) {
      video.volume = volume;
    }
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
    video.currentTime = Math.max(0, time);
  }

  private readonly onVolumeChange = () => {
    const mix = this.mix;
    const video = this.video;
    if (!mix || !video) return;
    if (Math.abs(video.volume - mix.lastWrittenVolume) > SILENT_VOLUME / 2) {
      // The player (new song normalisation) or the user changed the volume
      mix.baseVolume = video.volume;
      if (!mix.settleAt) this.tickMix();
    }
  };

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
    if (!mix.switched || mix.seeded) this.cancel('seeked');
  };

  private readonly onPause = () => {
    const mix = this.mix;
    if (mix && (!mix.switched || mix.seeded)) this.cancel('paused');
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
      this.cancel(`key ${event.key}`);
      return;
    }

    if (target?.closest(SEEK_AND_SKIP_CONTROLS)) this.cancel('player control');
  };

  private cancel(reason: string) {
    if (!this.mix) return;
    console.info('[AutoMix] mix cancelled:', reason);
    this.abort();
  }

  /** Incoming track position we want at context time `now` */
  private targetPosition(mix: ActiveMix, now: number) {
    return mix.plan.mixIn + (mix.plan.rate * (now - mix.mixAt));
  }

  private tickMix() {
    const mix = this.mix;
    const context = this.context;
    const video = this.video;
    if (!mix || !context || !video) return;

    const now = context.currentTime;

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
        this.cancel('song changed');
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
        this.cancel('song changed');
        return;
      }
    }

    if (id === mix.toId) this.prefetchAfter(mix);

    if (mix.settleAt !== undefined) {
      this.tickSettle(mix, now);
      return;
    }

    const incomingPlaying =
      id === mix.toId && video.readyState >= 3 && !video.seeking;

    if (incomingPlaying && mix.follow && !mix.handingOver) {
      const target = this.targetPosition(mix, now);
      if (target < 0) {
        // Too early for the incoming song: hold it at the very start
        if (video.currentTime > 0.25) this.seekIncoming(0);
        this.setRate(0.0625);
      } else {
        const error = video.currentTime - target;
        if (!mix.seeded || Math.abs(error) > 0.25) {
          this.seekIncoming(target + (SEEK_LATENCY * mix.plan.rate));
          this.setRate(mix.plan.rate);
          mix.seeded = true;
          mix.error = 0;
        } else {
          // Phase lock: nudge the tempo until the beats sit on top of each other
          mix.error = (mix.error * 0.7) + (error * 0.3);
          // Pull in hard while the player is still silent, gently after
          const silent = now < mix.mixAt || Boolean(mix.head);
          const pull = silent ? 0.1 : 0.04;
          // Close enough: run at exactly the planned rate. Every rate change
          // makes the player's position jump a little, so stop nudging early
          const deadband = mix.head ? 0.01 : 0.006;
          this.setRate(
            Math.abs(mix.error) < deadband
              ? mix.plan.rate
              : mix.plan.rate *
                  (1 - clamp(mix.error * (silent ? 2.5 : 1.5), -pull, pull)),
          );
          // Only count as in sync while steady at the planned rate
          mix.lockedTicks =
            Math.abs(error) < 0.012 &&
            Math.abs(mix.error) < 0.008 &&
            Math.abs(video.playbackRate - mix.plan.rate) < 0.0005
              ? mix.lockedTicks + 1
              : 0;
        }
      }
    }

    if (mix.head) {
      this.tickHead(mix, mix.head, now, incomingPlaying);
      return;
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
    if (mix.handingOver) return;
    this.setIncomingLevel(0);

    // Hand the song to the player (full quality) as soon as our copy has
    // nothing left to do that the player can't: once any filter has opened
    const canHandOver =
      now >= mix.mixAt + (mix.plan.filterIn ? filterOpenBy(mix.plan) : 0.3);
    const synced = mix.lockedTicks >= 8;
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
    const video = this.video;
    mix.handingOver = true;
    const at = now + 0.03;
    const fade = 0.06;

    // Our copy plays at normal speed: drop the catch-up nudging while the
    // player is still silent, so there's nothing to glide back afterwards
    this.setRate(1);

    // Cross over at whatever level the fade-in has reached by then
    const level = this.incomingLevel(mix, at);
    head.gain.gain.cancelScheduledValues(at);
    head.gain.gain.setValueAtTime(level, at);
    head.gain.gain.linearRampToValueAtTime(0, at + fade);
    head.source.stop(at + fade + 0.05);

    // Element volume can't be automated, so step it up against the ramp
    for (const step of [1, 2, 3, 4]) {
      const time = at + ((fade * step) / 4);
      this.at(time, () => {
        if (this.mix === mix) {
          this.setIncomingLevel((this.incomingLevel(mix, time) * step) / 4);
        }
      });
    }
    // The player carries on with the rest of the fade-in itself
    this.at(at + fade + 0.02, () => {
      if (this.mix !== mix || !video) return;
      mix.head = undefined;
      mix.handingOver = false;
      // Nothing to stay locked to any more (the old song is only a fading
      // tail), and nudging the now audible player's speed would be heard
      mix.follow = false;
    });
  }

  /** Start analysing the song after the incoming one while we mix */
  private prefetchAfter(mix: ActiveMix) {
    if (Date.now() - this.lastQueueRead < QUEUE_REFRESH_MS) return;
    this.lastQueueRead = Date.now();
    const upcoming = readQueue(mix.toId)?.next?.videoId;
    if (upcoming && upcoming !== mix.toId) this.ensureTrack(upcoming);
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
      progress,
    });
  }

  private cleanup(mix: ActiveMix, fadeSeconds: number) {
    const context = this.context;
    for (const timer of mix.timers) window.clearTimeout(timer);
    mix.timers = [];
    if (!context) return;

    const now = context.currentTime;
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
    // Let echo tails ring out before tearing the graph down
    window.setTimeout(
      () => {
        for (const node of mix.chain.nodes) node.disconnect();
      },
      (fadeSeconds + 6) * 1000,
    );
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
    const video = this.video;
    if (!mix) return;
    this.cleanup(mix, 0.3);
    if (video) video.volume = mix.baseVolume;
    this.restoreRate();
    this.mix = null;
    this.plan = null;
    this.planKey = '';
    this.currentId = null;
    this.schedule(IDLE_TICK_MS);
  }
}
