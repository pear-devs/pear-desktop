import { decodeAndAnalyze, type AnalyzedTrack } from './decoder';
import { planTransition, type TransitionPlan } from './planner';
import { getQueueStore, readQueue, type QueueTrack } from './queue';

import type { TrackAnalysis } from './analysis';
import type { AutoMixPluginConfig } from './config';
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
}

interface EngineOptions {
  api: MusicPlayer;
  fetchAudio: (videoId: string) => Promise<Uint8Array | null>;
  onStatus: (status: AutoMixStatus) => void;
}

interface OutgoingChain {
  source: AudioBufferSourceNode;
  dry: GainNode;
  master: GainNode;
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

const IDLE_TICK_MS = 250;
const FAST_TICK_MS = 20;
const QUEUE_REFRESH_MS = 2000;
const RETRY_FAILED_MS = 120_000;
/** Media seek takes a moment before audio resumes */
const SEEK_LATENCY = 0.08;
/** Tempo glide back to normal after a blend: slow, so it isn't heard */
const SETTLE_SECONDS = 14;
const CROSSOVER_HZ = 180;
const SILENT_VOLUME = 0.0001;
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
  bodyLoudness: -20,
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

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
      const bytes = await this.fetchAudio(videoId);
      if (!bytes || this.stopped) return null;
      return decodeAndAnalyze(
        videoId,
        bytes,
        this.context?.sampleRate ?? 48000,
      );
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

  private tickIdle(): number {
    const video = this.video;
    const id = this.currentVideoId();

    if (!this.config.active || !video || !id) {
      this.emit({ phase: 'inactive' });
      return IDLE_TICK_MS;
    }

    if (id !== this.currentId) {
      this.currentId = id;
      this.currentTitle = this.api.getVideoData()?.title ?? '';
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

    // The decoded audio must be the stream that's actually playing
    if (
      Number.isFinite(video.duration) &&
      Math.abs(video.duration - from.analysis.duration) > 2
    ) {
      this.plan = null;
      this.emit({ phase: 'waiting', reason: 'version-mismatch' });
      return IDLE_TICK_MS;
    }

    const key = JSON.stringify([id, nextId, Boolean(to), this.config]);
    const tooLate =
      this.plan &&
      video.currentTime > this.plan.mixOut - prerollFor(this.plan) + 0.5;
    if (key !== this.planKey || tooLate) {
      this.planKey = key;
      const plan = planTransition(from.analysis, to?.analysis ?? unknownTrack, {
        preference: to ? this.config.transition : 'smooth',
        blendBeats: this.config.blendBeats,
        maxStretch: this.config.maxStretch,
        smoothSeconds: this.config.smoothSeconds,
        earliestMixOut: Math.max(video.currentTime + 6.5, from.tailStart + 6.5),
      });
      this.plan = plan && !to ? { ...plan, reason: 'late-change' } : plan;
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

  private buildOutgoing(
    context: AudioContext,
    from: AnalyzedTrack,
  ): OutgoingChain {
    const source = context.createBufferSource();
    source.buffer = from.tail;

    const highpass = context.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 20;
    highpass.Q.value = 0.9;

    const lowShelf = context.createBiquadFilter();
    lowShelf.type = 'lowshelf';
    lowShelf.frequency.value = CROSSOVER_HZ;
    lowShelf.gain.value = 0;

    const lowpass = context.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 20000;
    lowpass.Q.value = 0.7;

    const dry = context.createGain();
    dry.gain.value = 0;
    const master = context.createGain();

    source
      .connect(highpass)
      .connect(lowShelf)
      .connect(lowpass)
      .connect(dry)
      .connect(master)
      .connect(context.destination);

    return {
      source,
      dry,
      master,
      nodes: [source, highpass, lowShelf, lowpass, dry, master],
    };
  }

  /** Schedules the outgoing side of the transition, sample accurately */
  private scheduleOutgoing(
    context: AudioContext,
    chain: OutgoingChain,
    plan: TransitionPlan,
    mixAt: number,
  ) {
    const [, highpass, lowShelf, lowpass] = chain.nodes as [
      AudioBufferSourceNode,
      BiquadFilterNode,
      BiquadFilterNode,
      BiquadFilterNode,
    ];
    const { dry } = chain;
    const duration = plan.duration;

    switch (plan.style) {
      case 'blend': {
        // Equal-power crossfade with a DJ style bass swap halfway through
        dry.gain.setValueCurveAtTime(equalPowerOut, mixAt, duration);
        lowShelf.gain.setValueAtTime(0, mixAt + (duration * 0.45));
        lowShelf.gain.linearRampToValueAtTime(-30, mixAt + (duration * 0.55));
        highpass.frequency.setValueAtTime(20, mixAt + (duration * 0.55));
        highpass.frequency.exponentialRampToValueAtTime(400, mixAt + duration);
        chain.source.stop(mixAt + duration + 0.1);
        break;
      }

      case 'cut': {
        // Filter build-up over the last bar, an echo throw, then a hard cut
        const beat = plan.beat || 0.5;
        const buildFrom = Math.max(context.currentTime, mixAt - (beat * 4));
        highpass.frequency.setValueAtTime(20, buildFrom);
        highpass.frequency.exponentialRampToValueAtTime(900, mixAt);

        const send = context.createGain();
        send.gain.value = 0;
        const delay = context.createDelay(2);
        delay.delayTime.value = Math.min(1.9, beat * 0.75);
        const feedback = context.createGain();
        feedback.gain.value = 0.45;
        const echoFilter = context.createBiquadFilter();
        echoFilter.type = 'highpass';
        echoFilter.frequency.value = 350;

        lowpass.connect(send).connect(delay).connect(echoFilter);
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

      case 'smooth': {
        // Long equal-power fade, the outgoing song slowly drifts behind a lowpass
        dry.gain.setValueCurveAtTime(equalPowerOut, mixAt, duration);
        lowpass.frequency.setValueAtTime(20000, mixAt);
        lowpass.frequency.exponentialRampToValueAtTime(700, mixAt + duration);
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
    source.connect(gain).connect(master).connect(context.destination);

    if (plan.style === 'cut') {
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

    const chain = this.buildOutgoing(context, from);
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
      plan.mixIn + (plan.style === 'cut' ? 0 : plan.duration) + 6 <
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
      endAt: mixAt + (plan.style === 'cut' ? 0.05 : plan.duration),
      switched: false,
      cutDone: false,
      head,
      lockedTicks: 0,
      handingOver: false,
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
    if (!mix.switched || mix.seeded) this.abort();
  };

  private readonly onPause = () => {
    const mix = this.mix;
    if (mix && (!mix.switched || mix.seeded)) this.abort();
  };

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
    if (id && id !== mix.toId && id !== mix.fromId) {
      // A different song than planned came up: just fade into it
      mix.toId = id;
      this.fallBackToFade(mix, now);
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
    const progress = (now - mix.mixAt) / mix.plan.duration;
    if (mix.plan.style === 'cut') {
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
      const level =
        progress <= 0
          ? 0
          : progress >= 1
            ? 1
            : Math.sin((progress * Math.PI) / 2);
      this.setIncomingLevel(incomingPlaying ? level : 0);
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

    const synced = mix.lockedTicks >= 8;
    const runningOut = now >= head.endAt - 1.5;
    if (now >= mix.endAt && incomingPlaying && (synced || runningOut)) {
      this.handOver(mix, head, now);
    } else if (now >= head.endAt - 0.2) {
      // The player never caught up: don't leave it muted
      this.abort();
      return;
    }
    this.emitMix();
  }

  private handOver(mix: ActiveMix, head: IncomingHead, now: number) {
    const video = this.video;
    mix.handingOver = true;
    const at = now + 0.03;
    const fade = 0.06;

    // Our copy plays at normal speed: drop the catch-up nudging while the
    // player is still silent, so there's nothing to glide back afterwards
    this.setRate(1);

    head.gain.gain.cancelScheduledValues(at);
    head.gain.gain.setValueAtTime(1, at);
    head.gain.gain.linearRampToValueAtTime(0, at + fade);
    head.source.stop(at + fade + 0.05);

    // Element volume can't be automated, so step it up against the ramp
    for (const step of [1, 2, 3, 4]) {
      this.at(at + ((fade * step) / 4), () => {
        if (this.mix === mix) this.setIncomingLevel(step / 4);
      });
    }
    this.at(at + fade + 0.02, () => {
      if (this.mix !== mix || !video) return;
      mix.head = undefined;
      mix.settleAt = this.context?.currentTime ?? now;
      mix.settleFrom = 1;
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
