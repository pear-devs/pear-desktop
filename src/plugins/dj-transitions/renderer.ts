import {
  analyzeBeats,
  audibleOffset,
  EnvelopeRecorder,
  alignBars,
  barTemplate,
  type BarTemplate,
  type BeatGrid,
  type WallEnvelope,
  type Envelope,
} from './beat';
import { findOutro, type Outro, type TailScan } from './outro';
import {
  destroyTransitionVisual,
  hideTransitionVisual,
  showTransitionVisual,
  type TrackInfo,
} from './overlay';

import type { DjTransitionsPluginConfig } from './index';
import type { RendererContext } from '@/types/contexts';
import type { QueueItem } from '@/types/datahost-get-state';
import type { MusicPlayer } from '@/types/music-player';
import type { QueueElement } from '@/types/queue';

/*
 * DJ transitions: true overlap with a hidden second player, beat-matched.
 *
 * Main window:  <video> → MediaElementSource → lowshelf (bass) → gain → out
 * Hidden window (backend.ts): the next song in the official player, same chain.
 *
 *  1. ~2 min before the end, the hidden player scans the current song's last
 *     minute (muted, 2×) to find where its outro starts and its music really
 *     ends (outro.ts). Then it loads the next song (from the queue, or pinned
 *     from autoplay), muted, measures its tempo and bar pattern from its body
 *     and finds where its music starts.
 *  2. Shortly before the outro, the current song's beat is measured from what
 *     has been playing (beat.ts) and, if both beats are clear, the blend is
 *     planned on the bar line nearest the outro:
 *       - tempos within 4 %: the incoming song plays at
 *         r = BPM_cur / BPM_next (pitch preserved);
 *       - further apart: both meet in between, the outgoing song taking
 *         ~2/3 of the change (≤ 25 %, ramping there first), the incoming ≤ 21 %;
 *       - the overlap is a whole number of bars, the two songs' bar patterns
 *         are cross-correlated so kick lands on kick, and the bass swap lands
 *         on a bar line.
 *     Otherwise it's a short plain blend with the incoming bass held back.
 *  3. Overlap with an equal-power crossfade,
 *       g_out(t) = cos(πt/2),  g_in(t) = sin(πt/2),  g_out² + g_in² = 1,
 *     while a loop nudges the incoming song's rate to keep beats locked.
 *  4. Handoff: the main player returns to normal speed and moves to the next
 *     song (skipping the rest of the old one after an early outro blend), the
 *     incoming song's rate eases back to 1, the main player seeks to the
 *     hidden player's position, then takes over with a short fade.
 *
 * YouTube Music plays gapless (the next song is appended to the same
 * MediaSource), so time comes from the player's per-song clock and song
 * changes are detected by video ID, not from <video> events.
 *
 * If the hidden player can't be prepared, it falls back to a single-player
 * fade-out / fade-in with the same curves.
 */

const log = (...args: unknown[]) => console.log('[dj-transitions]', ...args);

const BASS_FREQUENCY = 200; // Hz
const BASS_CUT_DB = -24;
const CURVE_POINTS = 256;
const RESTORE_SECONDS = 0.15;
const PREPARE_LEAD = 50; // s before the transition to start preloading (~20 s of analysis)
const END_PAD = 1.5; // s: finish the overlap this long before the (listed or real) end
const SCAN_LEAD = 115; // s before the end to scan the current song's outro
const SCAN_MIN_REMAINING = 95; // s: too late to scan + prepare below this
const SCAN_MIN_LENGTH = 120; // s: shorter songs aren't scanned
const MAX_EARLY = 45; // s: never start a blend earlier than this before the end
const PLAN_AHEAD = 12; // s before the blend to measure the beat and plan it (room for a tempo ramp)
const PLAIN_MAX_SECONDS = 4; // unmatched tempos: keep the overlap short
const PLAIN_BASS_SWAP = 0.75; // unmatched tempos: incoming bass late
const SKIP_AHEAD_MIN = 3; // s of old song left after a blend above which we skip it
const PREPARE_TIMEOUT = 90; // s: give up on the hidden player after this (scan + prepare ≈ 55 s)
const HANDOFF_GRACE = 3; // s to let the main player settle on the next song (or its video version)
const ELEMENT_WATCH_MS = 250; // how often to check whether YouTube Music swapped its <video>
const HANDOFF_FADE = 0.3; // s
const SYNC_TOLERANCE = 0.025; // s
const SYNC_SEEKS = 4; // max seeks to line the main player up at handoff
const HEARD_ROUNDS = 3; // seek + listen rounds at handoff
const HEARD_CAPTURE_SECONDS = 2.5; // s recorded from both players to compare by ear
const HEARD_TOLERANCE_MS = 12; // heard this close = in sync
const HEARD_MIN_CLARITY = 4; // correlation peak must stand out this much
const MAX_TEMPO_CHANGE = 0.04; // above this both songs share the tempo change
const MAX_MEET_CHANGE = 0.21; // incoming song's rate limit when meeting in the middle
const MAX_MEET_CHANGE_OUTGOING = 0.25; // outgoing song's limit (it ramps there gradually)
const MEET_OUTGOING_SHARE = 2 / 3; // share of the tempo change the outgoing song takes
const RAMP_SECONDS = 6; // current song ramps to the meeting tempo over this before the blend
const MIN_BEAT_CONFIDENCE = 5; // beat clarity needed to beat-match (reliable matches measured ~6–37)
const LOCK_INTERVAL = 250; // ms between beat-lock corrections
const LOCK_MAX_NUDGE = 0.04; // max ± rate correction while locking
const EASE_SECONDS = 3; // rate back to 1 after the overlap

type Ipc = RendererContext<DjTransitionsPluginConfig>['ipc'];

type Phase =
  | 'idle'
  | 'preparing' // hidden player is loading/analysing the next song
  | 'ready' // hidden player is parked at the next song's first sound/beat
  | 'overlap' // both songs playing, crossfading
  | 'handoff' // main player is reaching the next song and syncing
  | 'fading-out' // single-player fallback
  | 'fading-in' // single-player fallback
  | 'done'; // nothing more to do for this song

type BeatPlan = {
  startA: number; // song time of the current song where the overlap starts
  startB: number; // song time of the incoming song at that moment
  /** Incoming song-seconds per current song-second (BPM_cur / BPM_next). */
  rate: number;
  /**
   * Current song's playback rate during the overlap: 1 when only the incoming
   * song adjusts, else both meet in the middle at T = √(BPM_cur·BPM_next)
   * (current at T/BPM_cur, incoming at T/BPM_next = rate · rateA).
   */
  rateA: number;
  periodB: number; // incoming beat period (its own seconds)
  overlap: number; // current-song seconds
  swapAt: number; // current-song seconds after start
  bars: number;
  fireAt: number; // current-song time to call start (latency compensated)
  rampAt: number; // current-song time to start ramping its rate to rateA
  rampSeconds: number; // wall seconds of that ramp
};

let config: DjTransitionsPluginConfig | null = null;
let ipc: Ipc | null = null;
let player: MusicPlayer | null = null;

let audioContext: AudioContext | null = null;
let audioSource: MediaElementAudioSourceNode | null = null;
let shelf: BiquadFilterNode | null = null;
let gain: GainNode | null = null;
let video: HTMLMediaElement | null = null;
let recorder: EnvelopeRecorder | null = null;

let phase: Phase = 'idle';
let currentSongId: string | null = null;
let nextSongId: string | null = null;
let fallbackSongId: string | null = null;
let noNextLoggedFor: string | null = null;
let prepareTimeout: ReturnType<typeof setTimeout> | undefined;
let handoffGrace: ReturnType<typeof setTimeout> | undefined;
let overlapStartedAtRemaining = 0;
let handoffStartedAtRemaining = 0;
let handoffFromSongId: string | null = null;
let fadeOutStartedAtRemaining = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

let nextOnset = 0;
/** Outro of the song currently playing (from the tail scan), if scanned. */
let outroFor: { id: string; outro: Outro | null } | null = null;
let nextGrid: BeatGrid | null = null;
let nextTemplate: BarTemplate | null = null;
let plan: BeatPlan | null = null;
let planState: 'none' | 'planning' | 'planned' | 'plain' = 'none';
let startScheduled = false;
let rampStarted = false;
/** Rate the main player should hold (YouTube Music resets it otherwise). */
let mainRate = 1;
let easing: Promise<unknown> = Promise.resolve();
/** Learned delay between asking the hidden player to start and it playing. */
let startLatency = 0.055; // two test runs at 0.12 s started 59–70 ms early

// ---------------------------------------------------------------------------
// Helpers

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

const equalPowerCurve = (direction: 'in' | 'out', from = 1) => {
  const curve = new Float32Array(CURVE_POINTS);
  for (let i = 0; i < CURVE_POINTS; i++) {
    const x = i / (CURVE_POINTS - 1);
    curve[i] =
      direction === 'in'
        ? Math.sin((Math.PI * x) / 2)
        : Math.cos((Math.PI * x) / 2) * from;
  }
  return curve;
};

const isWired = () => Boolean(config && audioContext && gain && shelf && video);

const holdParam = (param: AudioParam, now: number) => {
  param.cancelAndHoldAtTime(now);
};

const setParamNow = (param: AudioParam, value: number, now: number) => {
  param.cancelScheduledValues(now);
  param.setValueAtTime(value, now);
};

/** Back to normal playback (full volume, full bass), quickly but click-free. */
const restore = (seconds = RESTORE_SECONDS) => {
  clearTimeout(timer);
  if (!audioContext || !gain || !shelf) return;
  const now = audioContext.currentTime;
  holdParam(gain.gain, now);
  holdParam(shelf.gain, now);
  gain.gain.linearRampToValueAtTime(1, now + seconds);
  shelf.gain.linearRampToValueAtTime(0, now + seconds);
};

/*
 * Main player speed. YouTube Music resets <video>.playbackRate to its own
 * value, so (like pear-desktop's playback-speed plugin) a ratechange listener
 * puts ours back while it differs from 1. At 1 we leave it alone, so other
 * speed settings aren't fought.
 */
const setMainRate = (rate: number) => {
  mainRate = rate;
  if (video) {
    video.preservesPitch = true;
    video.playbackRate = rate;
  }
};

const holdMainRate = () => {
  if (video && mainRate !== 1 && Math.abs(video.playbackRate - mainRate) > 1e-3) {
    video.playbackRate = mainRate;
  }
};

/** Ramp the main player's speed to `to` over `seconds` (gradual, like a DJ riding the pitch). */
const rampMainRate = async (to: number, seconds: number) => {
  // Driven by elapsed real time, not a step count, so late timers can't
  // stretch it: it always arrives at `to` on schedule.
  const from = mainRate;
  const t0 = performance.now();
  for (;;) {
    await sleep(50);
    if (phase !== 'ready' && phase !== 'overlap') return;
    const k = Math.min(1, (performance.now() - t0) / (seconds * 1000));
    setMainRate(from + ((to - from) * k));
    if (k >= 1) return;
  }
};

/** Page timers fire about this late (measured ~30 ms); aimed early by it. */
const TIMER_LAG = 0.035;

/**
 * Call `fn` when the current song reaches song time `at`. Re-reads the actual
 * position as it gets close and sets shorter timers, so speed changes (a
 * tempo ramp) and timer lag can't push it off by more than a few ms.
 */
const whenCurrentSongReaches = (at: number, fn: () => void) => {
  const tick = () => {
    if (phase !== 'ready') return;
    const ahead = at - (getPlayer()?.getCurrentTime() ?? at); // song seconds
    const wall = ahead / mainRate; // seconds
    if (wall <= TIMER_LAG) {
      fn();
      return;
    }
    timer = setTimeout(tick, Math.min(250, (wall - TIMER_LAG) * 1000));
  };
  clearTimeout(timer);
  tick();
};

/**
 * The live player element. Always looked up, not cached: if YouTube Music
 * replaces it, a cached one keeps reporting the old song and a frozen
 * position, and transitions silently stop.
 */
const getPlayer = () => {
  const live = document.querySelector<HTMLElement & MusicPlayer>('#movie_player');
  if (live && player && (player as unknown) !== live) {
    log('player element was replaced, following the new one');
    player = live;
  }
  return live ?? player;
};

const readSong = () => {
  const p = getPlayer();
  const details = p?.getPlayerResponse()?.videoDetails;
  if (!p || !details) return null;
  return {
    id: details.videoId,
    length: Number(details.lengthSeconds),
    position: p.getCurrentTime(),
  };
};

const queueItemVideoId = (item: unknown) => {
  const it = item as QueueItem | undefined;
  return (
    it?.playlistPanelVideoRenderer ??
    it?.playlistPanelVideoWrapperRenderer?.primaryRenderer
      ?.playlistPanelVideoRenderer
  )?.videoId;
};

/**
 * The song the player will play next, from YouTube Music's own queue state
 * (the on-screen queue list can be stale): the next queue item, else the
 * first item when repeating all, else the first autoplay ("automix") item.
 * None when repeating one song.
 */
const getNextSong = (): { id: string; fromAutoplay: boolean } | null => {
  const q = document
    .querySelector<QueueElement>('#queue')
    ?.queue?.store?.store?.getState()?.queue;
  if (!q) return null;
  if (q.repeatMode === 'ONE') return null;
  const pick = (item: unknown, fromAutoplay: boolean) => {
    const id = queueItemVideoId(item);
    return id ? { id, fromAutoplay } : null;
  };
  // selectedItemIndex can lag behind the song actually playing (seen after a
  // reload: it still pointed at the previous song), so locate the playing
  // song by ID — the match nearest selectedItemIndex, in case of repeats.
  const items = q.items ?? [];
  const playingId = getPlayer()?.getPlayerResponse()?.videoDetails?.videoId;
  const fromAutoplay = () => {
    if (!q.autoplay) return null;
    // A song we pinned from autoplay stays at the top of the autoplay list
    // after it plays from the queue, so skip anything already queued or
    // playing.
    const queued = new Set(items.map(queueItemVideoId));
    const candidate = (q.automixItems ?? []).find((item) => {
      const id = queueItemVideoId(item);
      return id && id !== playingId && !queued.has(id);
    });
    return pick(candidate, true);
  };

  let index = q.selectedItemIndex;
  if (playingId && queueItemVideoId(items[index]) !== playingId) {
    let best = -1;
    items.forEach((item, i) => {
      if (
        queueItemVideoId(item) === playingId &&
        (best < 0 || Math.abs(i - q.selectedItemIndex) < Math.abs(best - q.selectedItemIndex))
      ) {
        best = i;
      }
    });
    // Not in the queue at all: it's playing from autoplay, so the next song
    // comes from autoplay too (selectedItemIndex is stale then).
    if (best < 0) return fromAutoplay();
    index = best;
  }
  const next = items[index + 1];
  if (next) return pick(next, false);
  if (q.repeatMode === 'ALL') return pick(items[0], false);
  return fromAutoplay();
};

const getNextSongId = () => getNextSong()?.id ?? null;

/**
 * Whether two IDs are the same track: YouTube Music pairs a song with its
 * music-video version ("counterpart") and can switch between them.
 */
const isSameSong = (a: string | null, b: string | null) => {
  if (!a || !b) return false;
  if (a === b) return true;
  const q = document
    .querySelector<QueueElement>('#queue')
    ?.queue?.store?.store?.getState()?.queue;
  const all: unknown[] = [...(q?.items ?? []), ...(q?.automixItems ?? [])];
  for (const item of all) {
    const wrapper = (item as QueueItem).playlistPanelVideoWrapperRenderer;
    if (!wrapper) continue;
    const ids = [
      wrapper.primaryRenderer?.playlistPanelVideoRenderer?.videoId,
      ...(wrapper.counterpart ?? []).map(
        (c) => c.counterpartRenderer?.playlistPanelVideoRenderer?.videoId,
      ),
    ];
    if (ids.includes(a) && ids.includes(b)) return true;
  }
  return false;
};

const runsText = (value: unknown) =>
  ((value as { runs?: { text?: string }[] } | undefined)?.runs ?? [])
    .map((r) => r.text ?? '')
    .join('');

const largestThumbnail = (value: unknown) => {
  const list = (
    value as { thumbnails?: { url?: string; width?: number }[] } | undefined
  )?.thumbnails;
  if (!list?.length) return undefined;
  return [...list].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url;
};

/** Title, artist and cover of the song playing in the main player. */
const currentTrackInfo = (): TrackInfo => {
  const details = getPlayer()?.getPlayerResponse()?.videoDetails as
    | { title?: string; author?: string; thumbnail?: unknown }
    | undefined;
  return {
    title: details?.title ?? '',
    artist: details?.author ?? '',
    art: largestThumbnail(details?.thumbnail),
  };
};

/** Title, artist and cover of a song in the queue or autoplay list. */
const queuedTrackInfo = (videoId: string | null): TrackInfo => {
  const q = document
    .querySelector<QueueElement>('#queue')
    ?.queue?.store?.store?.getState()?.queue;
  const all: unknown[] = [...(q?.items ?? []), ...(q?.automixItems ?? [])];
  for (const item of all) {
    const it = item as QueueItem;
    const r =
      it.playlistPanelVideoRenderer ??
      it.playlistPanelVideoWrapperRenderer?.primaryRenderer
        ?.playlistPanelVideoRenderer;
    if (r?.videoId === videoId) {
      return {
        title: runsText(r.title),
        artist: runsText(r.shortBylineText) || runsText(r.longBylineText),
        art: largestThumbnail(r.thumbnail),
      };
    }
  }
  return { title: 'Next song', artist: '' };
};

type HiddenTime = { t: number; at: number; rate: number; playing: boolean };

const hiddenTime = async () =>
  (await ipc!.invoke('dj-transitions:time')) as HiddenTime;

/** Hidden player's song time right now (extrapolated over the IPC delay). */
const hiddenNow = async () => {
  const h = await hiddenTime();
  return h.t + ((h.rate * (Date.now() - h.at)) / 1000);
};

const setHiddenRate = (rate: number) =>
  ipc?.invoke('dj-transitions:rate', rate).catch(() => undefined);

const releaseHidden = (seconds: number) =>
  ipc?.invoke('dj-transitions:release', seconds).catch(() => undefined);

const cancelHidden = () =>
  ipc?.invoke('dj-transitions:cancel').catch(() => undefined);

const waitForPlayback = (timeoutMs: number) =>
  new Promise<void>((resolve) => {
    const t0 = Date.now();
    const check = () => {
      if (
        !video ||
        (!video.seeking && !video.paused && video.readyState >= 3) ||
        Date.now() - t0 > timeoutMs
      ) {
        resolve();
      } else {
        setTimeout(check, 30);
      }
    };
    check();
  });

const resetTransition = () => {
  clearTimeout(handoffGrace);
  nextSongId = null;
  nextGrid = null;
  nextTemplate = null;
  plan = null;
  planState = 'none';
  startScheduled = false;
  rampStarted = false;
};

/** Stop any transition in progress and play the main player normally. */
const abort = (reason: string, next: Phase = 'done', fade = 0.3) => {
  log('transition aborted:', reason);
  hideTransitionVisual();
  clearTimeout(timer);
  setMainRate(1);
  if (phase === 'overlap' || phase === 'handoff') releaseHidden(fade);
  else if (phase === 'preparing' || phase === 'ready') cancelHidden();
  restore(fade);
  phase = next;
  resetTransition();
};

type SongPos = { id: string; length: number; position: number };

const outroOf = (song: SongPos) =>
  outroFor?.id === song.id ? outroFor.outro : null;

/** Latest point a blend may finish: the real end of the music if known. */
const blendEnd = (song: SongPos) =>
  Math.min(song.length - END_PAD, outroOf(song)?.musicEnd ?? Infinity);

/**
 * Where a blend of `overlap` seconds should start: where the outro begins if
 * the song was scanned (no earlier than MAX_EARLY before the end), else as
 * late as fits.
 */
const blendTarget = (song: SongPos, overlap: number) => {
  const latest = blendEnd(song) - overlap;
  const outro = outroOf(song);
  if (!outro) return latest;
  return Math.max(song.length - MAX_EARLY, Math.min(outro.outroStart, latest));
};

const describeGrid = (g: BeatGrid | null) =>
  g ? `${g.bpm.toFixed(1)} BPM (clarity ${g.confidence.toFixed(2)})` : 'no beat';

// ---------------------------------------------------------------------------
// Preparing the incoming song

/**
 * Tempo and bar pattern from the song's body (intros often have no drums).
 * The pattern is lined up with the current song later, in makePlan; its grid
 * is carried back to the start of the song by whole bars.
 */
const analyzeNextSong = (env: Envelope | null) => {
  const grid = env ? analyzeBeats(env) : null;
  nextGrid = grid;
  nextTemplate = env && grid ? barTemplate(env, grid.period) : null;
};

/** Look ahead at the current song's ending (hidden player, muted, 2×). */
const scanOutro = async (songId: string) => {
  log('scanning the end of the current song for its outro');
  let outro: Outro | null = null;
  try {
    const scan = (await ipc!.invoke('dj-transitions:scan-tail', songId)) as TailScan;
    outro = scan.ok ? findOutro(scan) : null;
    if (outro) {
      const profile = outro.profile
        .filter((_, i, all) => i % Math.max(1, Math.round(all.length / 30)) === 0)
        .map(({ t, db }) => `${t.toFixed(0)}:${db.toFixed(0)}`)
        .join(' ');
      log(
        `outro: from ${outro.outroStart.toFixed(1)}s (${outro.outroDb.toFixed(1)} dB vs middle), music ends ${outro.musicEnd.toFixed(1)}s of ${scan.length}s | level s:dB ${profile}`,
      );
    } else {
      log('outro: none found, blending at the end');
    }
  } catch (error) {
    log('outro scan failed, blending at the end', error);
  }
  outroFor = { id: songId, outro };
};

const prepareNext = (songId: string, nextId: string, scan: boolean) => {
  phase = 'preparing';
  nextSongId = nextId;

  // If the hidden player stops responding, don't wait forever.
  clearTimeout(prepareTimeout);
  prepareTimeout = setTimeout(() => {
    if (phase === 'preparing' && currentSongId === songId) {
      abort('hidden player took too long, using single-player fade', 'idle');
      fallbackSongId = songId;
    }
  }, PREPARE_TIMEOUT * 1000);

  (scan ? scanOutro(songId) : Promise.resolve())
    .then(() => {
      if (phase !== 'preparing' || currentSongId !== songId) {
        throw new Error('superseded');
      }
      log('preparing next song in hidden player', nextId);
      return ipc!.invoke('dj-transitions:prepare', nextId);
    })
    .then((result) => {
      const r = result as {
        ok: boolean;
        id?: string;
        onset?: number;
        body?: Envelope | null;
      };
      if (phase !== 'preparing' || currentSongId !== songId) return;
      if (r.ok) {
        phase = 'ready';
        nextOnset = r.onset ?? 0;
        analyzeNextSong(r.body ?? null);
        log(
          `hidden player ready: music starts at ${nextOnset.toFixed(2)}s, ${describeGrid(nextGrid)}, ${(r.body as { stalls?: number } | null | undefined)?.stalls ?? '?'} stalled blocks dropped`,
        );
      } else {
        log('hidden player loaded a different song, using single-player fade', r.id);
        phase = 'idle';
        resetTransition();
        fallbackSongId = songId;
        cancelHidden();
      }
    })
    .catch((error: unknown) => {
      if (currentSongId !== songId || phase !== 'preparing') return;
      log('hidden player failed, using single-player fade', error);
      phase = 'idle';
      resetTransition();
      fallbackSongId = songId;
    });
};

/** Work out a beat-matched start, or decide on a plain blend. */
const makePlan = async (song: SongPos) => {
  if (!recorder || !config) return;
  planState = 'planning';
  const fade = config.fadeSeconds;
  const envA = recorder.window(20);
  const gridA = analyzeBeats(envA);
  const gridB = nextGrid;
  log(`beat: current ${describeGrid(gridA)}, next ${describeGrid(gridB)}`);

  const plain = (why: string) => {
    log('plain blend:', why);
    planState = 'plain';
  };

  if (!gridA || !gridB || !nextTemplate) return plain('no clear beat');
  if (
    gridA.confidence < MIN_BEAT_CONFIDENCE ||
    gridB.confidence < MIN_BEAT_CONFIDENCE
  ) {
    return plain('beat not clear enough');
  }

  // Incoming song-seconds per current song-second. Close tempos: only the
  // incoming song adjusts. Further apart: both meet in the middle, each
  // changing by the same factor √rate, within MAX_MEET_CHANGE.
  const rate = gridA.bpm / gridB.bpm;
  let rateA = 1;
  if (Math.abs(1 - rate) > MAX_TEMPO_CHANGE) {
    // The outgoing song takes most of the change (it's leaving, and it ramps
    // there gradually beforehand), so the incoming song stays nearer its
    // normal speed and has less to glide back afterwards.
    const lnRate = Math.log(rate);
    rateA = clamp(
      Math.exp(-MEET_OUTGOING_SHARE * lnRate),
      1 - MAX_MEET_CHANGE_OUTGOING,
      1 + MAX_MEET_CHANGE_OUTGOING,
    );
    const rateB = rate * rateA;
    if (Math.abs(1 - rateB) > MAX_MEET_CHANGE) {
      return plain(`tempos too far apart, even meeting in the middle (×${rate.toFixed(3)})`);
    }
  }

  const periodA = gridA.period;
  const periodB = gridB.period; // = periodA · rate
  let bars = Math.max(1, Math.round(fade / (4 * periodA)));
  let overlap = bars * 4 * periodA;
  while (bars > 1 && blendEnd(song) - overlap < song.position + 1) {
    bars--;
    overlap = bars * 4 * periodA;
  }

  // Line up the two bar patterns: `anchorB` (incoming song time) sits at the
  // same place in the bar as `anchorA` (current song time).
  const templateA = barTemplate(envA, periodA);
  const anchorA = templateA.anchor;
  const anchorB = alignBars(templateA, nextTemplate);
  const barB = 4 * periodB;

  // Bar line (from the anchor) nearest where the blend should start — the
  // outro if one was found — that still fits before the end. If that's
  // already passed, the next bar line; a beat line if no whole bar fits.
  const barA = 4 * periodA;
  const latest = blendEnd(song) - overlap;
  const target = blendTarget(song, overlap);
  const soonest = song.position + 1;
  const at = (b: number) => anchorA + (b * periodA);
  let beat = Math.round((target - anchorA) / barA) * 4;
  while (beat > 0 && at(beat) > latest) beat -= 4;
  if (at(beat) < soonest) beat = Math.ceil((soonest - anchorA) / barA) * 4;
  if (at(beat) > latest) beat = Math.ceil((soonest - anchorA) / periodA);
  const startA = at(beat);
  if (startA < soonest || startA > latest + 0.001) {
    return plain('too close to the end');
  }

  // The incoming song at the same place in the bar, moved by whole bars to
  // the first one where its music has started.
  let startB = anchorB + (beat * periodB);
  startB -= barB * Math.floor((startB - nextOnset + 0.05) / barB);
  if (startB < 0) startB += barB;

  const parked = (await ipc!
    .invoke('dj-transitions:park', startB)
    .catch(() => null)) as number | null;
  if (parked === null || phase !== 'ready') return plain('could not park');

  // If the park landed a little off the beat, start that much earlier/later.
  const parkShift = (startB - parked) / rate;
  const swapAt = bars >= 2 ? Math.round(bars / 2) * 4 * periodA : 2 * periodA;

  // startLatency is wall time; the current song covers rateA song-seconds
  // per wall second once it has ramped.
  const fireAt = startA - (startLatency * rateA) - parkShift;
  // Ramp the current song to rateA just before the blend, over as much of
  // RAMP_SECONDS as fits (it covers (1 + rateA)/2 song-seconds per second).
  const averageRate = (1 + rateA) / 2;
  const rampSeconds =
    rateA === 1
      ? 0
      : clamp((fireAt - song.position - 0.3) / averageRate, 0.5, RAMP_SECONDS);

  plan = {
    startA,
    startB,
    rate,
    rateA,
    periodB,
    overlap,
    swapAt,
    bars,
    fireAt,
    rampAt: fireAt - (rampSeconds * averageRate),
    rampSeconds,
  };
  planState = 'planned';
  const tempo =
    rateA === 1
      ? `next ×${rate.toFixed(4)}`
      : `meeting at ${(gridA.bpm * rateA).toFixed(1)} BPM: current ×${rateA.toFixed(3)} (ramp ${rampSeconds.toFixed(1)}s), next ×${(rate * rateA).toFixed(3)}`;
  log(
    `plan: ${bars} bar(s) = ${overlap.toFixed(2)}s, start at ${startA.toFixed(2)}s (aimed at ${target.toFixed(2)}s${outroOf(song) ? ', the outro' : ''}) → next at ${startB.toFixed(2)}s, ${tempo}, bass swap at +${swapAt.toFixed(2)}s`,
  );
};

// ---------------------------------------------------------------------------
// Overlap

/** Keep the incoming song's beats on the current song's grid. */
const beatLock = async (p: BeatPlan) => {
  let first = true;
  let n = 0;
  while (phase === 'overlap') {
    await sleep(LOCK_INTERVAL);
    if (phase !== 'overlap') break;
    let h: HiddenTime;
    try {
      h = await hiddenTime();
    } catch {
      break;
    }
    const now = Date.now();
    const aT = getPlayer()?.getCurrentTime() ?? 0;
    const bT = h.t + ((h.rate * (now - h.at)) / 1000);
    let err = bT - (p.startB + ((aT - p.startA) * p.rate)); // incoming seconds
    err -= p.periodB * Math.round(err / p.periodB); // nearest beat
    const errA = err / p.rate;

    if (first) {
      first = false;
      // errA is in current-song seconds; startLatency is wall seconds.
      startLatency = clamp(startLatency - (errA / p.rateA), 0, 0.6);
      log(`beat-lock: started ${(errA * 1000).toFixed(0)} ms off`);
    } else if (n++ % 4 === 0) {
      log(`beat-lock: ${(errA * 1000).toFixed(0)} ms`);
    }

    const nudge = clamp(errA / 0.75, -LOCK_MAX_NUDGE, LOCK_MAX_NUDGE);
    await setHiddenRate(p.rate * p.rateA * (1 - nudge));
  }
};

/** Bigger tempo changes ease back more slowly (≈ 4 s per 10 %). */
/** ≈1.2 % speed change per second: slow enough not to sound like drifting. */
const easeSecondsFor = (from: number) =>
  clamp(Math.abs(1 - from) * 80, EASE_SECONDS, 14);

/**
 * Glide the incoming song back to normal speed along an S-curve (gentle at
 * both ends), driven by elapsed time so late timers can't make it jumpy.
 */
const easeHiddenRate = async (from: number) => {
  if (Math.abs(1 - from) < 1e-4) return;
  const seconds = easeSecondsFor(from);
  const t0 = performance.now();
  for (;;) {
    await sleep(100);
    // Stop if the handoff was cancelled (the hidden player is gone).
    if (phase !== 'handoff') return;
    const k = Math.min(1, (performance.now() - t0) / (seconds * 1000));
    const s = k * k * (3 - (2 * k)); // smoothstep
    await setHiddenRate(from + ((1 - from) * s));
    if (k >= 1) return;
  }
};

/** What the liquid-glass card shows for this blend. */
const transitionVisualFor = (
  p: BeatPlan | null,
  wallSeconds: number,
  swapAt: number,
  nextId: string | null,
) => {
  let label = 'Blending';
  let beatSeconds: number | undefined;
  if (p) {
    const periodA = p.periodB / p.rate; // current-song seconds per beat
    const bpmA = 60 / periodA;
    const bpmB = 60 / p.periodB;
    beatSeconds = periodA / p.rateA; // wall seconds per beat while mixing
    label =
      p.rateA === 1
        ? `Beat-matched · ${bpmA.toFixed(0)} → ${bpmB.toFixed(0)} BPM`
        : `Meeting at ${(bpmA * p.rateA).toFixed(0)} BPM`;
  }
  return {
    from: currentTrackInfo(),
    to: queuedTrackInfo(nextId),
    seconds: wallSeconds,
    label,
    beatSeconds,
    swapAt,
  };
};

const startOverlap = async (seconds: number, remaining: number) => {
  if (!audioContext || !gain || !shelf || !config || !nextSongId) return;
  phase = 'overlap';
  overlapStartedAtRemaining = remaining;
  const p = plan;
  // A plan's lengths are in current-song seconds; at rateA they pass faster
  // or slower in real (wall) time, which is what the audio curves use.
  const rateA = p ? p.rateA : 1;
  if (p && rateA !== 1) setMainRate(rateA); // in case the ramp didn't finish
  const wallSeconds = seconds / rateA;
  // Unmatched tempos: the incoming bass (kick) comes in late, so two kicks
  // drifting against each other overlap as little as possible.
  const swapAt = p ? p.swapAt / rateA : seconds * PLAIN_BASS_SWAP;
  const hiddenRate = p ? p.rate * rateA : 1;

  const started = (await ipc!
    .invoke(
      'dj-transitions:start',
      nextSongId,
      wallSeconds,
      config.bassSwap,
      swapAt,
      hiddenRate,
    )
    .catch(() => false)) as boolean;
  if (phase !== 'overlap') return;
  if (!started) {
    log('hidden player did not start, using single-player fade');
    phase = 'idle';
    fallbackSongId = currentSongId;
    return;
  }

  const now = audioContext.currentTime;
  const from = gain.gain.value;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueCurveAtTime(equalPowerCurve('out', from), now, wallSeconds);
  holdParam(shelf.gain, now);
  if (config.bassSwap) {
    // Outgoing bass drops on the swap beat as the incoming bass comes in.
    shelf.gain.setValueAtTime(shelf.gain.value, now + Math.max(0, swapAt - 0.06));
    shelf.gain.linearRampToValueAtTime(BASS_CUT_DB, now + swapAt);
  }

  let kind = '(plain)';
  if (p) {
    kind =
      rateA === 1
        ? `(beat-matched, next ×${hiddenRate.toFixed(4)})`
        : `(beat-matched in the middle, current ×${rateA.toFixed(3)}, next ×${hiddenRate.toFixed(3)})`;
  }
  log(`overlap over ${wallSeconds.toFixed(2)}s →`, nextSongId, kind);
  if (config.animation !== false) {
    showTransitionVisual(transitionVisualFor(p, wallSeconds, swapAt, nextSongId));
  }
  if (p) beatLock(p);
  clearTimeout(timer);
  timer = setTimeout(handoff, wallSeconds * 1000);
};

/*
 * The overlap is over and the main player is silent. Near the end, don't skip
 * it: the song's real end can come a little before its listed length, so a
 * skip can race the player's own gapless advance and jump two songs. Let it
 * reach the next song by itself (silently), then sync in onSongChange. After
 * an early (outro) blend there's plenty of song left, so skipping is safe.
 */
const handoff = () => {
  if (phase !== 'overlap' || !audioContext || !gain || !shelf) return;
  phase = 'handoff';
  const now = audioContext.currentTime;
  setParamNow(gain.gain, 0, now);
  setParamNow(shelf.gain, 0, now);
  // The old song is silent now: back to normal speed before the main player
  // moves on. The incoming (hidden) one eases back from its own speed.
  setMainRate(1);
  const hiddenRate = plan ? plan.rate * plan.rateA : 1;
  easing = plan ? easeHiddenRate(hiddenRate) : Promise.resolve();

  const song = readSong();
  if (song?.id === nextSongId) {
    syncAndSwap();
    return;
  }
  const remaining = song ? Math.max(0, song.length - song.position) : 0;
  handoffStartedAtRemaining = remaining;
  handoffFromSongId = song?.id ?? null;
  if (remaining > SKIP_AHEAD_MIN) {
    log(
      `handoff: skipping the last ${remaining.toFixed(1)}s of the old song to reach`,
      nextSongId,
    );
    getPlayer()?.nextVideo();
  } else {
    log(
      `handoff: waiting ${remaining.toFixed(1)}s for the main player to reach`,
      nextSongId,
    );
  }

  // Sometimes the player stops at the end instead of advancing. Only once it
  // has fully ended (so this can't race its own advance), move it on.
  // timeupdate doesn't fire while ended, so watch here.
  const deadline =
    Date.now() + ((remaining + easeSecondsFor(hiddenRate) + 8) * 1000);
  let nudged = false;
  const watch = () => {
    if (phase !== 'handoff') return;
    const p = getPlayer();
    const id = readSong()?.id;
    if (id && id !== currentSongId) {
      onSongChange(id);
      return;
    }
    if (!nudged && p?.getPlayerState() === 0 /* ended */) {
      nudged = true;
      log('main player stopped at the end, moving it to the next song');
      p.nextVideo();
    }
    if (Date.now() > deadline) {
      abort('main player never reached the next song');
      return;
    }
    timer = setTimeout(watch, 250);
  };
  clearTimeout(timer);
  timer = setTimeout(watch, 250);
};

/**
 * How far behind the hidden player the main player is *heard* (ms; negative
 * = ahead), from a short recording of both, or null if unclear.
 */
const heardOffsetMs = async () => {
  if (!recorder || !ipc) return null;
  const capture = (await ipc
    .invoke('dj-transitions:capture', HEARD_CAPTURE_SECONDS)
    .catch((error: unknown) => {
      log('audio check: hidden capture failed', error);
      return null;
    })) as WallEnvelope | null;
  if (!capture?.low?.length) {
    log('audio check: hidden player recorded nothing usable');
    return null;
  }
  await sleep(250); // let the main recorder catch up on the same stretch
  const end = capture.wallT0 + (capture.low.length * capture.dt * 1000);
  const mine = recorder.wallWindow(capture.wallT0 - 400, end + 400);
  if (!mine) {
    log(
      `audio check: main recording doesn't cover the hidden one (${recorder.describeWall()}, hidden ${capture.wallT0.toFixed(0)}–${end.toFixed(0)})`,
    );
    return null;
  }
  const result = audibleOffset(mine, capture, 300);
  if (!result || result.clarity < HEARD_MIN_CLARITY) {
    const peak = (w: WallEnvelope) =>
      Math.max(...w.low, ...w.high).toExponential(1);
    log(
      `audio check: no clear match (clarity ${result?.clarity.toFixed(1)}, offset ${result?.offsetMs.toFixed(0)} ms, ${mine.low.length} vs ${capture.low.length} frames, loudness main ${peak(mine)} / hidden ${peak(capture)})`,
    );
    return null;
  }
  return result.offsetMs;
};

/** Main player is on the next song (at gain 0): line it up, then swap. */
const syncAndSwap = async () => {
  clearTimeout(timer);
  const p = getPlayer();
  if (!p || !video || !audioContext || !gain) return;

  try {
    await easing; // hidden must be back at rate 1 before we line up

    // Seek to where the hidden player will be once the seek lands, folding
    // each attempt's measured error into the next seek's lead. (Nudging the
    // main player's playback rate instead proved unreliable: YouTube's player
    // sometimes ignores it or jumps by 150+ ms. Seeks land within ~30 ms.)
    //
    // Then check by ear: the clocks can agree while the audio doesn't (e.g.
    // the hidden player was just time-stretched), which sounds like an echo.
    // If they're heard apart, aim the clocks apart by that much and re-seek.
    let lead = 0.25;
    let target = 0; // main − hidden clock difference that sounds aligned
    let diff = Infinity;
    let heard: number | null = null;
    for (let round = 0; round < HEARD_ROUNDS; round++) {
      for (let attempt = 0; attempt < SYNC_SEEKS; attempt++) {
        p.seekTo((await hiddenNow()) + lead);
        await waitForPlayback(3000);
        await sleep(200);
        diff = p.getCurrentTime() - (await hiddenNow()) - target;
        log(`sync seek ${attempt + 1}: main is ${(diff * 1000).toFixed(0)} ms off`);
        if (Math.abs(diff) < SYNC_TOLERANCE) break;
        lead -= diff;
      }
      if (phase !== 'handoff') return;
      heard = await heardOffsetMs();
      if (heard === null) {
        // Often one player was momentarily silent (still buffering after its
        // seek, or a beatless moment): listen once more before giving up.
        await sleep(500);
        if (phase !== 'handoff') return;
        heard = await heardOffsetMs();
      }
      if (heard === null) {
        log('audio check: inconclusive, switching quickly to be safe');
        break;
      }
      log(
        `audio check: main sounds ${Math.abs(heard).toFixed(0)} ms ${heard >= 0 ? 'behind' : 'ahead'}`,
      );
      if (Math.abs(heard) <= HEARD_TOLERANCE_MS) break;
      target += heard / 1000;
      lead += heard / 1000;
    }
    log(
      heard === null
        ? `synced to ${(diff * 1000).toFixed(0)} ms (by clock)`
        : `synced to ${heard.toFixed(0)} ms by ear`,
    );

    if (phase !== 'handoff') return;
    // Verified in sync by ear: short equal-power crossfade (same audio,
    // inaudible). Not verified, or still off: a very quick swap, so any
    // offset is a tiny jump rather than an echo (the clocks alone have been
    // 100 ms out by ear).
    const synced = heard !== null && Math.abs(heard) <= HEARD_TOLERANCE_MS * 2;
    const fade = synced ? HANDOFF_FADE : 0.08;
    const now = audioContext.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueCurveAtTime(equalPowerCurve('in'), now, fade);
    await releaseHidden(fade);
    log('handoff complete');
  } catch (error) {
    log('sync failed, switching straight to the main player', error);
    restore(0.5);
    releaseHidden(0.5);
  } finally {
    setMainRate(1);
    if (phase === 'handoff') {
      phase = 'idle';
      resetTransition();
    }
  }
};

// ---------------------------------------------------------------------------
// Single-player fallback

const startFadeOut = (seconds: number) => {
  if (!audioContext || !gain || !shelf || !config) return;
  const now = audioContext.currentTime;
  const from = gain.gain.value;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueCurveAtTime(equalPowerCurve('out', from), now, seconds);
  holdParam(shelf.gain, now);
  if (config.bassSwap) {
    shelf.gain.setValueAtTime(shelf.gain.value, now + (seconds * 0.4));
    shelf.gain.linearRampToValueAtTime(BASS_CUT_DB, now + (seconds * 0.6));
  }
  phase = 'fading-out';
  fadeOutStartedAtRemaining = seconds;
  log(`single-player fade-out over ${seconds.toFixed(1)}s`);
};

const startFadeIn = () => {
  if (!audioContext || !gain || !shelf || !config) return;
  const seconds = config.fadeSeconds;
  const now = audioContext.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueCurveAtTime(equalPowerCurve('in'), now, seconds);
  setParamNow(shelf.gain, config.bassSwap ? BASS_CUT_DB : 0, now);
  if (config.bassSwap) {
    const swapAt = now + (seconds / 2);
    shelf.gain.setValueAtTime(BASS_CUT_DB, swapAt);
    shelf.gain.linearRampToValueAtTime(0, swapAt + RESTORE_SECONDS);
  }
  phase = 'fading-in';
  log(`single-player fade-in over ${seconds}s`);
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (phase === 'fading-in') phase = 'idle';
  }, seconds * 1000);
};

// ---------------------------------------------------------------------------
// Driving it from playback

/*
 * During a handoff YouTube Music sometimes passes through another ID first —
 * typically the next song's music-video version (its "counterpart") — before
 * settling. Wait a moment instead of abandoning a good blend.
 */
const waitForNextSongToSettle = (id: string) => {
  log(
    `main player is on ${id}${isSameSong(id, nextSongId) ? ' (the video version of the next song)' : ''}, waiting for it to settle`,
  );
  clearTimeout(handoffGrace);
  handoffGrace = setTimeout(() => {
    if (phase !== 'handoff') return;
    const now = readSong()?.id ?? null;
    if (now === nextSongId) {
      syncAndSwap();
    } else if (now && isSameSong(now, nextSongId)) {
      // Stayed on the video version: hand off anyway. Its audio may be timed
      // differently; the by-ear check catches that (or switches quickly).
      log('main player stayed on the video version, handing off to it');
      syncAndSwap();
    } else {
      abort(`queue moved to ${now}, expected ${nextSongId}`, 'idle', 1);
    }
  }, HANDOFF_GRACE * 1000);
};

const onSongChange = (id: string) => {
  const previous = currentSongId;
  currentSongId = id;
  if (previous === null) return;

  switch (phase) {
    case 'handoff':
      clearTimeout(handoffGrace);
      if (id === nextSongId) syncAndSwap();
      else waitForNextSongToSettle(id);
      return;
    case 'overlap':
      if (id === nextSongId) {
        // The song ended (or was skipped) before our timer: hand off now.
        clearTimeout(timer);
        phase = 'overlap';
        handoff();
      } else if (isSameSong(id, nextSongId)) {
        // Landed on the next song's other (music video) version: treat it as
        // the handoff and let it settle.
        clearTimeout(timer);
        phase = 'handoff';
        setMainRate(1);
        easing = plan ? easeHiddenRate(plan.rate * plan.rateA) : Promise.resolve();
        waitForNextSongToSettle(id);
      } else {
        abort(`song changed during overlap to ${id} (expected ${nextSongId}, was ${previous})`, 'idle', 1);
      }
      return;
    case 'preparing':
    case 'ready':
      abort(`song changed before the transition to ${id} (was ${previous})`, 'idle');
      return;
    case 'fading-out':
      startFadeIn();
      return;
    case 'fading-in':
      return;
    default:
      phase = 'idle';
      restore();
  }
};

const onReady = (song: SongPos, remaining: number) => {
  if (!config || !video) return;
  const fade = config.fadeSeconds;

  if (remaining > SCAN_LEAD + 15) {
    abort('seeked away from the end', 'idle');
    return;
  }
  if (video.paused) return;

  // The queue can change after we preloaded (user edits, autoplay refills).
  // Don't blend in a song that won't actually play next.
  if (!startScheduled) {
    const upcoming = getNextSongId();
    if (upcoming && upcoming !== nextSongId) {
      abort(`next song changed to ${upcoming}`, 'idle');
      return;
    }
  }

  // Plan a few seconds ahead of the target, so the current song's beat is
  // measured from what's just played and only extrapolated briefly.
  if (planState === 'none' && song.position >= blendTarget(song, fade) - PLAN_AHEAD) {
    makePlan(song).catch((error: unknown) => {
      log('planning failed, plain blend', error);
      planState = 'plain';
    });
    return;
  }

  if (planState === 'planned' && plan && !startScheduled) {
    const p = plan;
    // Meeting in the middle: ramp the current song toward the shared tempo
    // first, so it arrives there gradually just as the blend starts.
    if (p.rateA !== 1 && !rampStarted && song.position >= p.rampAt) {
      rampStarted = true;
      log(`ramping current song to ×${p.rateA.toFixed(3)} over ${p.rampSeconds.toFixed(1)}s`);
      rampMainRate(p.rateA, p.rampSeconds);
    }
    if (song.position >= p.fireAt - (1.5 * mainRate)) {
      startScheduled = true;
      whenCurrentSongReaches(p.fireAt, () => {
        const now = readSong();
        if (phase !== 'ready' || !now) return;
        startOverlap(p.overlap, now.length - now.position);
      });
    }
    return;
  }

  if (planState === 'plain') {
    const seconds = Math.min(fade, PLAIN_MAX_SECONDS);
    const left = blendEnd(song) - song.position;
    if (song.position >= blendTarget(song, seconds) && left > 0.5) {
      startOverlap(Math.min(seconds, left), remaining);
    }
  }
};

const onTimeUpdate = () => {
  if (!isWired() || !video || !config) return;

  const song = readSong();
  if (!song) return;
  if (song.id !== currentSongId) onSongChange(song.id);

  const { length, position } = song;
  if (!Number.isFinite(length) || length <= 0) return;
  const remaining = length - position;
  const fade = config.fadeSeconds;
  const transitionAt = fade + END_PAD;
  const eligible = !video.loop && length > fade * 3;

  switch (phase) {
    case 'idle': {
      if (!eligible || video.paused) return;
      if (fallbackSongId !== song.id && remaining > transitionAt + 3) {
        // Early enough: scan this song's outro, then prepare the next one.
        // Otherwise just prepare (blend at the end), as close as before.
        const scan =
          outroFor?.id !== song.id &&
          length >= SCAN_MIN_LENGTH &&
          remaining <= SCAN_LEAD &&
          remaining > SCAN_MIN_REMAINING;
        if (scan || remaining <= transitionAt + PREPARE_LEAD) {
          const next = getNextSong();
          if (next && next.id !== song.id) {
            if (next.fromAutoplay) {
              // End of the queue: autoplay may pick differently at the last
              // moment, so pin its current pick as "play next".
              log('next song comes from autoplay, adding it to the queue', next.id);
              ipc?.invoke('dj-transitions:queue-next', next.id).catch(() => undefined);
            }
            prepareNext(song.id, next.id, scan);
          } else if (noNextLoggedFor !== song.id) {
            noNextLoggedFor = song.id;
            log(
              next
                ? 'next song is this song again (repeat?), no blend'
                : 'no next song found in the queue or autoplay, no blend',
            );
          }
        }
        return;
      }
      // Too late to prepare, or the hidden player failed: single-player fade.
      if (remaining <= fade && remaining > 0.3) startFadeOut(remaining);
      return;
    }
    case 'ready':
      onReady(song, remaining);
      return;
    case 'overlap':
      if (remaining > overlapStartedAtRemaining + 1) {
        abort('seeked back during overlap', 'idle');
      }
      return;
    case 'handoff':
      // Still on the old song (muted) and it jumped back: the listener
      // wants it, not the next one.
      if (song.id === handoffFromSongId && remaining > handoffStartedAtRemaining + 2) {
        abort('seeked back after the blend', 'idle');
      }
      return;
    case 'fading-out':
      if (remaining > fadeOutStartedAtRemaining + 1) {
        phase = 'idle';
        restore();
      }
      return;
    default:
  }
};

const onPause = () => {
  if (!audioContext || !gain || !shelf) return;
  if (phase !== 'idle' && phase !== 'done') {
    log(`main player paused at ${getPlayer()?.getCurrentTime().toFixed(1)}s during ${phase}`);
  }
  if (phase === 'overlap') {
    abort('paused during overlap');
  } else if (phase === 'fading-out') {
    const now = audioContext.currentTime;
    holdParam(gain.gain, now);
    holdParam(shelf.gain, now);
    phase = 'idle'; // timeupdate resumes the fade from the held level
  } else if (phase === 'fading-in') {
    phase = 'idle';
    restore();
  }
};

// ---------------------------------------------------------------------------
// Wiring

/*
 * YouTube Music sometimes replaces its <video> element (seen when it moves to
 * the next song by itself). pear-desktop routes only the original element
 * into Web Audio, so after a swap the new one plays straight to the speakers,
 * bypassing the plugin's volume control (two copies heard out of step at a
 * handoff), and the plugin's analysers and handlers sit on a dead element.
 * So watch for the swap and move everything onto the live element. An element
 * can only get one MediaElementSource ever, so they're remembered.
 */
const sources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();
let elementWatch: ReturnType<typeof setInterval> | undefined;

const attachHandlers = (el: HTMLMediaElement) => {
  el.addEventListener('timeupdate', onTimeUpdate, { passive: true });
  el.addEventListener('pause', onPause, { passive: true });
  el.addEventListener('ratechange', holdMainRate, { passive: true });
};

const detachHandlers = (el: HTMLMediaElement) => {
  el.removeEventListener('timeupdate', onTimeUpdate);
  el.removeEventListener('pause', onPause);
  el.removeEventListener('ratechange', holdMainRate);
};

const followVideoElement = () => {
  if (!audioContext || !shelf || !video) return;
  const live =
    document.querySelector<HTMLVideoElement>('#movie_player video') ??
    document.querySelector<HTMLVideoElement>('video');
  if (!live || live === video) return;

  let source = sources.get(live);
  if (!source) {
    try {
      source = audioContext.createMediaElementSource(live);
    } catch (error) {
      log('video element was replaced but could not be re-routed', error);
      clearInterval(elementWatch);
      return;
    }
    sources.set(live, source);
  }

  detachHandlers(video);
  try {
    audioSource?.disconnect(shelf);
  } catch {
    // not connected
  }
  try {
    source.disconnect(audioContext.destination);
  } catch {
    // not connected straight to the speakers
  }
  recorder?.disconnect();

  source.connect(shelf);
  audioSource = source;
  video = live;
  recorder = new EnvelopeRecorder(
    audioContext,
    source,
    () => getPlayer()?.getCurrentTime() ?? 0,
  );
  attachHandlers(live);
  if (mainRate !== 1) setMainRate(mainRate);
  log('YouTube Music replaced its video element; re-routed the new one through the plugin');
};

const wire = (context: AudioContext, source: MediaElementAudioSourceNode) => {
  sources.set(source.mediaElement, source);
  // Already wired: just make sure we're on the live element.
  if (gain && audioContext === context) {
    followVideoElement();
    return;
  }

  audioContext = context;
  audioSource = source;
  video = source.mediaElement;

  shelf = context.createBiquadFilter();
  shelf.type = 'lowshelf';
  shelf.frequency.value = BASS_FREQUENCY;
  shelf.gain.value = 0;

  gain = context.createGain();
  gain.gain.value = 1;

  try {
    source.disconnect(context.destination);
  } catch {
    // Another plugin may have rerouted it already.
  }
  source.connect(shelf);
  shelf.connect(gain);
  gain.connect(context.destination);

  recorder = new EnvelopeRecorder(
    context,
    source,
    () => getPlayer()?.getCurrentTime() ?? 0,
  );
  log('wired into audio graph');

  attachHandlers(video);
  clearInterval(elementWatch);
  elementWatch = setInterval(followVideoElement, ELEMENT_WATCH_MS);
  followVideoElement(); // in case the swap already happened
};

const unwire = () => {
  clearTimeout(timer);
  clearInterval(elementWatch);
  if (phase !== 'idle' && phase !== 'done') abort('plugin stopped');
  if (video) {
    detachHandlers(video);
    setMainRate(1);
  }
  recorder?.disconnect();
  recorder = null;
  if (audioSource && audioContext && shelf && gain) {
    try {
      audioSource.disconnect(shelf);
      gain.disconnect();
      audioSource.connect(audioContext.destination);
    } catch (error) {
      console.error('[dj-transitions] unwire failed', error);
    }
  }
  audioSource = null;
  shelf = null;
  gain = null;
  video = null;
  currentSongId = null;
  fallbackSongId = null;
  resetTransition();
  phase = 'idle';
};

const audioCanPlayListener = (
  event: CustomEvent<{
    audioContext: AudioContext;
    audioSource: MediaElementAudioSourceNode;
  }>,
) => {
  wire(event.detail.audioContext, event.detail.audioSource);
};

/** Show the transition card for the current and next song, without mixing. */
const previewTransitionVisual = () => {
  const nextId = nextSongId ?? getNextSongId();
  const periodA = 60 / 124;
  showTransitionVisual({
    from: currentTrackInfo(),
    to: queuedTrackInfo(nextId),
    seconds: 8,
    label: 'Preview · beat-matched',
    beatSeconds: periodA,
    swapAt: 4,
  });
};

export const onRendererLoad = async (
  context: RendererContext<DjTransitionsPluginConfig>,
) => {
  config = await context.getConfig();
  ipc = context.ipc;
  document.addEventListener('peard:audio-can-play', audioCanPlayListener, {
    passive: true,
  });
  // From the plugin menu (via the main process), or a page event.
  ipc.on('dj-transitions:preview', previewTransitionVisual);
  document.addEventListener('dj-transitions:preview', previewTransitionVisual);
  log('loaded', JSON.stringify(config));
};

/**
 * If the plugin starts while a song is already playing, the
 * "audio can play" event for that song has already fired, so we'd only get
 * wired on the next track. Reload the current song at the same position to
 * fire it again (same trick as the audio-compressor plugin).
 */
let wireRetry: ReturnType<typeof setInterval> | undefined;
let lastReloadAt = 0;

const ensureWired = () => {
  const p = player;
  if (audioSource || !p) {
    clearInterval(wireRetry);
    return;
  }
  const videoDetails = p.getPlayerResponse()?.videoDetails;
  if (!videoDetails || p.getPlayerState() !== 1 /* playing */) return;
  if (Date.now() - lastReloadAt < 8000) return;
  lastReloadAt = Date.now();

  log('song already playing, reloading it in place to wire in');
  p.loadVideoById(
    videoDetails.videoId,
    p.getCurrentTime(),
    p.getUserPlaybackQualityPreference(),
  );
};

export const onPlayerApiReady = (playerApi: MusicPlayer) => {
  player = playerApi;
  ensureWired();
  // Playback may start a moment later (e.g. on app start): keep checking.
  clearInterval(wireRetry);
  if (!audioSource) wireRetry = setInterval(ensureWired, 2000);
};

export const onRendererUnload = () => {
  clearInterval(wireRetry);
  document.removeEventListener('peard:audio-can-play', audioCanPlayListener);
  document.removeEventListener('dj-transitions:preview', previewTransitionVisual);
  ipc?.removeAllListeners('dj-transitions:preview');
  unwire();
  destroyTransitionVisual();
};

export const onConfigChange = (newConfig: DjTransitionsPluginConfig) => {
  config = newConfig;
  if (!newConfig.animation) hideTransitionVisual();
  if (!newConfig.enabled) unwire();
};
