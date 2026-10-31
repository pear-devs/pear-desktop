/**
 * Apple Music AutoMix's beat-matched effect styles, ported from the style
 * catalog shipped in iOS 27 (_SonicKit_MusicKit, TransitionStyles.json).
 *
 * Each style is a set of automation lanes per song over the transition
 * window. A lane sits in a placement (a part of the window) and ramps one
 * parameter between two values along one of Apple's curves. Tempo lanes are
 * left out: the engine's shared tempo glide already does what they do.
 */

/** What a lane automates, on the per-song chain built in the engine */
export type EffectParam =
  /** Song level after everything (Apple's RECEIVE_MIXER out_gain) */
  | 'gain'
  /** Song level before everything, cutting it while echoes ring (INPUT_GAIN) */
  | 'input'
  | 'lowpass'
  | 'highpass'
  /** Low-shelf gain at the crossover, in dB (a bass swap) */
  | 'bass'
  /** Level into the echo / reverb send (SEND_MIXER) */
  | 'send'
  /** Level of the send's return, and of the dry song (RECEIVE_MIXER fx mix) */
  | 'wet'
  | 'dry'
  /** Share of the send that's echoed rather than passed on, 0..1 */
  | 'delayMix'
  /** The rest of the send, passed on as is (follows delayMix by itself) */
  | 'delayDry'
  | 'delayFeedback'
  | 'delayLowpass';

/**
 * Apple's curve names: "ease-out-p" is x^p and "ease-in-p" is
 * 1 - (1 - x)^p (the constant-power cross-fade uses ease-in-0.5 to fade out
 * and ease-out-0.5 to fade in, which only works out this way round).
 * "log" moves geometrically (equal steps per octave), like Spotify's filter
 * knob.
 */
type Curve = 'linear' | 'log' | `in-${number}` | `out-${number}`;

/** A point in the window: a fraction of it, optionally plus seconds */
type At = number | [fraction: number, seconds: number];

export interface Lane {
  param: EffectParam;
  from: number;
  to: number;
  curve: Curve;
  /** Within the placement */
  t: [At, At];
  /** Within the window */
  place: [At, At];
}

export type EffectFamily = 'filter' | 'hiphop' | 'pop' | 'spotify';

export interface EffectStyle {
  /** Apple's style id */
  id: number;
  name: string;
  family: EffectFamily;
  /** Apple's nominal length, in bars */
  bars: number;
  /** Echo time follows the beat */
  delay?: boolean;
  /** Reverb decay time in seconds, when the style has a reverb send */
  reverb?: number;
  /**
   * Beat repeater on the outgoing song: from the first point on, a slice
   * taken there loops instead of the song, retriggered (and shortened) at
   * each point. `bars` is the slice length, from Apple's rate index into
   * 1/1, 1/2, 1/4, 1/8, 1/16, 1/32, 1/64 (of a bar)
   */
  repeats?: { at: At; bars: number }[];
  /** When the repeater lets go of the song again (default: never) */
  repeatEnd?: At;
  outgoing: Lane[];
  incoming: Lane[];
}

const lane = (
  param: EffectParam,
  from: number,
  to: number,
  curve: Curve,
  t: [At, At] = [0, 1],
  place: [At, At] = [0, 1],
): Lane => ({ param, from, to, curve, t, place });

/** A value that's set at a point and held (neutral until then) */
const set = (param: EffectParam, value: number, at: At = 0): Lane =>
  lane(param, value, value, 'linear', [0, 1], [at, at]);

export const EFFECT_STYLES: EffectStyle[] = [
  {
    id: 8,
    name: 'Filter high to low',
    family: 'filter',
    bars: 8,
    outgoing: [
      lane('lowpass', 20_000, 200, 'out-2'),
      lane('gain', 1, 0, 'linear', [0, 1], [[1, -0.3], 1]),
    ],
    incoming: [
      lane('highpass', 20_000, 10, 'out-2'),
      lane('lowpass', 1200, 20_000, 'in-4'),
      lane('gain', 0, 1, 'linear', [0, 1], [0, [0, 0.3]]),
    ],
  },
  {
    id: 9,
    name: 'Filter expansion',
    family: 'filter',
    bars: 8,
    outgoing: [
      lane('lowpass', 20_000, 20, 'out-2', [0.5, 1]),
      lane('highpass', 20, 200, 'out-0.5', [0.5, 0.75]),
      lane('gain', 1, 0, 'linear', [0, 1], [[1, -0.3], 1]),
    ],
    incoming: [
      lane('lowpass', 1000, 20_000, 'out-0.5', [0, 0.75]),
      lane('highpass', 1000, 20, 'out-2', [0.5, 0.75]),
      lane('gain', 0, 1, 'linear', [0, 1], [0, [0, 0.3]]),
    ],
  },
  {
    id: 12,
    name: 'Long filter high to low',
    family: 'filter',
    bars: 16,
    outgoing: [
      lane('lowpass', 20_000, 200, 'out-2', [0, 1], [0.25, 0.75]),
      lane('gain', 1, 0, 'linear', [0, 1], [[0.75, -0.3], 0.75]),
    ],
    incoming: [
      lane('highpass', 20_000, 10, 'out-2', [0, 1], [0.25, 0.75]),
      lane('lowpass', 1200, 20_000, 'in-4', [0, 1], [0.25, 0.75]),
      lane('gain', 0, 1, 'linear', [0, 1], [0.25, [0.25, 0.3]]),
    ],
  },
  {
    id: 15,
    name: 'Delay out',
    family: 'hiphop',
    bars: 4,
    delay: true,
    outgoing: [
      // One short slice thrown into the echo at the half-way point, then
      // only its echoes are left of the old song
      lane('delayMix', 0, 1, 'out-2', [0, [0, 1]], [0.5, 0.75]),
      set('delayFeedback', 0.35),
      set('delayLowpass', 3000),
      lane('send', 1, 0, 'linear', [0, [0, 0.1]], [0.5, 0.75]),
      lane('highpass', 20, 200, 'out-0.5', [0.25, 0.5]),
      set('wet', 1, 0.5),
      set('dry', 0, 0.5),
      lane('gain', 1, 0, 'linear', [0, 1], [[1, -1], 1]),
    ],
    incoming: [
      lane('lowpass', 200, 20_000, 'in-4', [0.25, 0.75]),
      lane('highpass', 300, 20, 'out-0.5', [0.25, 0.75]),
      lane('gain', 0, 1, 'linear', [0, 1], [0.375, [0.375, 1]]),
    ],
  },
  {
    id: 16,
    name: 'Delay out',
    family: 'pop',
    bars: 4,
    delay: true,
    outgoing: [
      lane('lowpass', 20_000, 3500, 'out-2', [0.125, 0.25]),
      set('delayMix', 1),
      set('delayFeedback', 0.6),
      set('delayLowpass', 3500),
      lane('send', 0, 0.5, 'linear', [0, 0.25]),
      set('wet', 1),
      lane('gain', 1, 0, 'linear', [0.375, 0.5]),
      // The song stops a quarter in; its echoes carry on
      set('input', 0, 0.25),
    ],
    incoming: [
      lane('highpass', 5200, 20, 'out-2', [0.1875, 0.4375]),
      lane('gain', 0, 1, 'linear', [0, 1], [0.1875, 0.375]),
    ],
  },
  {
    id: 18,
    name: 'Looping',
    family: 'hiphop',
    bars: 4,
    // Half way, the last beat loops while it's filtered away
    repeats: [{ at: 0.5, bars: 1 / 4 }],
    outgoing: [lane('lowpass', 20_000, 20, 'out-2', [0.525, 1])],
    incoming: [
      lane('highpass', 2000, 20, 'out-2', [0, 0.75]),
      lane('gain', 0.3162, 1, 'in-0.5', [0, 0.75]),
    ],
  },
  {
    id: 20,
    name: 'Reverb',
    family: 'pop',
    bars: 4,
    reverb: 6,
    // Apple runs this one on its Remix FX unit: filter A (low-pass on the
    // way out, high-pass on the way in), filter B the other kind, a reverb
    outgoing: [
      lane('lowpass', 20_000, 20, 'out-4', [0.25, 0.75]),
      lane('highpass', 20, 600, 'linear', [0.2813, 0.5]),
      lane('highpass', 600, 927, 'linear', [0.5, 0.75]),
      lane('send', 0, 1, 'linear', [0.3125, 0.525]),
      set('wet', 0.8),
      lane('gain', 1, 0.4217, 'linear', [0.375, 0.75]),
      lane('gain', 0.4217, 0, 'linear', [0.75, 1]),
    ],
    incoming: [
      lane('highpass', 3300, 20, 'out-2', [0.25, 0.75]),
      lane('lowpass', 20, 20_000, 'in-4', [0.25, 0.75]),
      lane('gain', 0, 1, 'out-2', [0.25, 0.75]),
    ],
  },
];

/*
 * Spotify's playlist-mix presets (desktop 1.305, decompiled from Spotify.dll
 * and its style catalog). A preset is a volume shape, a 3-band EQ move and a
 * one-knob DJ filter, all over the whole overlap. Most keep both songs at
 * full level and swap the bass at the midpoint. Spotify kills the low band
 * and swaps it in 1/64 of the window, which slams the new bass in; ours
 * turns the low shelf down 30 dB (like our own blends' swap) and ramps it
 * evenly in dB over a quarter of the window around the same point.
 * Spotify's filter knob is geometric (low-pass 120 Hz to 16 kHz, high-pass
 * 20 Hz to 9 kHz). Style id = 100 + Spotify's preset id.
 */
const BASS_CUT_DB = -30;
const SWAP: [At, At] = [0.375, 0.625];
/** Hard volume steps get a short ramp so they don't click */
const STEP = 0.02;
const step = (param: EffectParam, from: number, to: number, at: number) =>
  lane(param, from, to, 'linear', [0, 1], [at, [at, STEP]]);

type Side = { outgoing: Lane[]; incoming: Lane[] };

const volume = {
  /** Both songs at full level; the old one stops at the end */
  fullOverlap: {
    outgoing: [step('gain', 1, 0, 1 - (STEP / 4))],
    incoming: [step('gain', 0, 1, 0)],
  },
  /**
   * Spotify's cross shape drops the old song dead at 60 % and starts the new
   * one at 40 %, which sounds like a cut (and cuts a short blend off half
   * way). Ours keeps the overlap but fades: the new song rises over 20–60 %,
   * the old one falls over 40–80 %, both constant power.
   */
  crossShape: {
    outgoing: [lane('gain', 1, 0, 'in-0.5', [0, 1], [0.4, 0.8])],
    incoming: [lane('gain', 0, 1, 'out-0.5', [0, 1], [0.2, 0.6])],
  },
  slowInSlowOut: {
    outgoing: [lane('gain', 1, 0, 'linear', [0, 1], [0.5, 1])],
    incoming: [lane('gain', 0, 1, 'linear', [0, 1], [0, 0.5])],
  },
  slowInFastOutAtEnd: {
    outgoing: [step('gain', 1, 0, 1 - (STEP / 4))],
    incoming: [lane('gain', 0, 1, 'linear', [0, 1], [0, 0.5])],
  },
  fastInAtStartSlowOut: {
    outgoing: [lane('gain', 1, 0, 'linear', [0, 1], [0.5, 1])],
    incoming: [step('gain', 0, 1, 0)],
  },
} satisfies Record<string, Side>;

/** Bass out of the old song and into the new one around the midpoint */
const bassSwap = (at: [At, At] = SWAP): Side => ({
  outgoing: [lane('bass', 0, BASS_CUT_DB, 'linear', [0, 1], at)],
  incoming: [
    set('bass', BASS_CUT_DB),
    lane('bass', BASS_CUT_DB, 0, 'linear', [0, 1], at),
  ],
});

/**
 * The style with its bass swap moved to `at` (fractions of the window), for
 * a next song whose bass only comes in late; styles without one are kept
 */
export const withBassSwap = (
  style: EffectStyle,
  at: [number, number] | undefined,
): EffectStyle => {
  if (!at || !style.outgoing.some((item) => item.param === 'bass')) {
    return style;
  }
  const swap = bassSwap(at);
  const moved = compose(style, swap);
  // A high-pass sweeping the old song out would take its bass away before
  // the swap: it waits for the swap to be done
  const start = (place: At) => (typeof place === 'number' ? place : place[0]);
  moved.outgoing = moved.outgoing.map((item) =>
    item.param === 'highpass' && start(item.place[0]) < at[1]
      ? { ...item, place: [at[1], item.place[1]] }
      : item,
  );
  return { ...style, ...moved };
};

/** The new song opens from a 120 Hz low-pass over the first half */
const lowpassIn: Side = {
  outgoing: [],
  incoming: [
    lane('lowpass', 120, 16_000, 'log', [0, 1], [0, 0.5]),
    set('lowpass', 20_000, 0.5),
  ],
};
/** The old song closes down to a 120 Hz low-pass over the second half */
const lowpassOut: Side = {
  outgoing: [lane('lowpass', 16_000, 120, 'log', [0, 1], [0.5, 1])],
  incoming: [],
};
/** The new song opens from a 9 kHz high-pass over the first half */
const highpassIn: Side = {
  outgoing: [],
  incoming: [
    lane('highpass', 9000, 20, 'log', [0, 1], [0, 0.5]),
    set('highpass', 10, 0.5),
  ],
};
/** The old song thins out to a 9 kHz high-pass over the second half */
const highpassOut: Side = {
  outgoing: [lane('highpass', 20, 9000, 'log', [0, 1], [0.5, 1])],
  incoming: [],
};

/** Parts later in the list replace earlier ones on the same parameter */
const compose = (...sides: Side[]): Side => {
  const merge = (pick: (side: Side) => Lane[]) =>
    sides.reduce<Lane[]>((lanes, side) => {
      const next = pick(side);
      const params = new Set(next.map((item) => item.param));
      return [...lanes.filter((item) => !params.has(item.param)), ...next];
    }, []);
  return {
    outgoing: merge((side) => side.outgoing),
    incoming: merge((side) => side.incoming),
  };
};

const spotify = (id: number, name: string, side: Side): EffectStyle => ({
  id: 100 + id,
  name,
  family: 'spotify',
  bars: 4,
  ...side,
});

/**
 * The presets Spotify's planner picks from by itself (its EQ-only "Blend"
 * is left out, and two pairs of presets that sound the same are kept once)
 */
export const SPOTIFY_STYLES: EffectStyle[] = [
  spotify(1, 'Fade', compose(volume.crossShape, bassSwap())),
  spotify(
    3,
    'Rise',
    // Spotify swaps the bass at the very end, but its high-pass has taken
    // the old song's bass away well before: swapped half way, like the rest
    compose(volume.fullOverlap, bassSwap(), lowpassIn, highpassOut),
  ),
  spotify(
    4,
    'Melt',
    compose(volume.slowInSlowOut, bassSwap(), highpassIn, highpassOut),
  ),
  spotify(
    5,
    'Filter out',
    compose(volume.slowInFastOutAtEnd, bassSwap(), highpassOut),
  ),
  spotify(
    9,
    'Filter in',
    compose(volume.fastInAtStartSlowOut, bassSwap(), highpassIn),
  ),
  spotify(
    10,
    'Filter in and out',
    compose(volume.fullOverlap, bassSwap(), highpassIn, highpassOut),
  ),
  spotify(17, 'Wave', compose(volume.fullOverlap, bassSwap(), lowpassIn, lowpassOut)),
  spotify(
    18,
    'Low-pass out',
    compose(volume.slowInFastOutAtEnd, bassSwap(), lowpassOut),
  ),
];

/** Spotify only uses these three on its 2-bar blends */
const SHORT_SPOTIFY_STYLES = [101, 110, 117];

/** Neutral value of each parameter, where a style doesn't touch it */
export const EFFECT_DEFAULTS: Record<EffectParam, number> = {
  gain: 1,
  input: 1,
  lowpass: 20_000,
  highpass: 10,
  bass: 0,
  send: 0,
  wet: 0,
  dry: 1,
  delayMix: 0,
  delayDry: 1,
  delayFeedback: 0,
  delayLowpass: 20_000,
};

export const ease = (curve: Curve, x: number) => {
  if (curve === 'linear' || curve === 'log') return x;
  const power = Number(curve.slice(curve.indexOf('-') + 1));
  return curve.startsWith('out') ? x ** power : 1 - ((1 - x) ** power);
};

/** A lane's value a fraction `x` of the way through its ramp */
export const laneValue = (item: Lane, x: number) =>
  item.curve === 'log' && item.from > 0 && item.to > 0
    ? item.from * ((item.to / item.from) ** x)
    : item.from + ((item.to - item.from) * ease(item.curve, x));

const resolve = (at: At, start: number, length: number) =>
  typeof at === 'number'
    ? start + (at * length)
    : start + (at[0] * length) + at[1];

/** A point in a window starting at `start`, in seconds */
export const timeIn = (at: At, start: number, duration: number) =>
  resolve(at, start, duration);

/** Absolute placement start, and start / end of a lane's ramp, in a window */
export const laneTimes = (item: Lane, start: number, duration: number) => {
  const placeStart = resolve(item.place[0], start, duration);
  const placeEnd = resolve(item.place[1], start, duration);
  const length = placeEnd - placeStart;
  return {
    placed: placeStart,
    from: resolve(item.t[0], placeStart, length),
    to: resolve(item.t[1], placeStart, length),
  };
};

/** Points per ramp: Apple's curves as short straight segments */
const RAMP_POINTS = 24;

/**
 * Schedules a song's lanes over the window starting at `start`. A parameter
 * is neutral until its first lane's placement begins, holds that lane's
 * start value until its ramp, then follows its lanes in order and holds the
 * last value. The incoming song is silent until its level lane brings it in.
 */
export const scheduleLanes = (
  params: Partial<Record<EffectParam, AudioParam>>,
  lanes: Lane[],
  start: number,
  duration: number,
  side: 'outgoing' | 'incoming',
) => {
  const neutral = (name: EffectParam) =>
    name === 'gain' && side === 'incoming' ? 0 : EFFECT_DEFAULTS[name];
  const byParam = new Map<EffectParam, Lane[]>();
  const mirrored = lanes
    .filter((item) => item.param === 'delayMix')
    .map((item) => ({
      ...item,
      param: 'delayDry' as const,
      from: 1 - item.from,
      to: 1 - item.to,
    }));
  for (const item of [...lanes, ...mirrored]) {
    byParam.set(item.param, [...(byParam.get(item.param) ?? []), item]);
  }
  for (const [name, items] of byParam) {
    const param = params[name];
    if (!param) continue;
    const clamp = (value: number) =>
      Math.min(param.maxValue, Math.max(param.minValue, value));
    const timed = items
      .map((item) => ({ item, times: laneTimes(item, start, duration) }))
      .sort((a, b) => a.times.from - b.times.from);
    param.cancelScheduledValues(start);
    param.setValueAtTime(clamp(neutral(name)), start);
    const first = timed[0];
    param.setValueAtTime(
      clamp(first.item.from),
      Math.max(start, Math.min(first.times.placed, first.times.from)),
    );
    for (const { item, times } of timed) {
      const { from, to } = times;
      param.setValueAtTime(clamp(item.from), Math.max(start, from));
      if (to <= from) {
        param.setValueAtTime(clamp(item.to), Math.max(start, from));
        continue;
      }
      for (let k = 1; k <= RAMP_POINTS; k++) {
        const x = k / RAMP_POINTS;
        param.linearRampToValueAtTime(
          clamp(laneValue(item, x)),
          from + ((to - from) * x),
        );
      }
    }
  }
};

/** Main genre names each family is for (Apple's genre ids 18 + 15, and 14) */
const FAMILY_GENRES: Partial<Record<EffectFamily, string[]>> = {
  hiphop: ['Hip-Hop/Rap', 'R&B/Soul'],
  pop: ['Pop'],
};

/** Apple's seed for its weighted pick, so a pair always gets the same style */
const djb2 = (text: string) => {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash * 33) + text.charCodeAt(i)) >>> 0;
  }
  return hash;
};

/**
 * The style for a beat-matched blend of `bars` bars. Like Apple's planner,
 * the filter sweeps go with anything danceable and a genre's own styles join
 * them when both songs are of that genre, all in the same (beat-matched)
 * tier; among the styles that fit the blend's length one is picked by a hash
 * of the pair. (Apple mixed This Is What You Came For into One Kiss, both
 * Dance, with filter expansion.)
 */
export const pickEffect = (
  fromGenre: string | undefined,
  toGenre: string | undefined,
  bars: number,
  seed: string,
): EffectStyle => {
  const fits = (style: EffectStyle) =>
    bars >= style.bars / 2 && bars <= style.bars * 2;
  const genreFamily = (Object.keys(FAMILY_GENRES) as EffectFamily[]).find(
    (family) =>
      FAMILY_GENRES[family]?.includes(fromGenre ?? '') &&
      FAMILY_GENRES[family]?.includes(toGenre ?? ''),
  );
  const candidates = EFFECT_STYLES.filter(
    (style) =>
      (style.family === 'filter' || style.family === genreFamily) &&
      fits(style),
  );
  if (candidates.length === 0) return EFFECT_STYLES[0];
  return candidates[djb2(seed) % candidates.length];
};

/**
 * Apple's Smart Cross-Fade styles come with and without a reverb on the
 * outgoing song (33 / 44): its send opens to 0.75 over the first 2 s and the
 * tail (about 5.5 s) rings on after the song. Our fades keep their own
 * levels and only take the reverb.
 */
export const CROSSFADE_REVERB = {
  id: 44,
  name: 'Reverb ring-out',
  decay: 5.5,
  send: 0.75,
  sendSeconds: 2,
};

/** Half of the pairs get the reverb, like Apple's pick between 4 and 44 */
export const pickCrossfadeReverb = (seed: string) => djb2(seed) % 2 === 0;

/**
 * Spotify's pick for a beat-matched blend of `bars` bars: one of its presets,
 * the same one every time for a pair (Spotify's choice is a fixed function
 * of the pair too)
 */
export const pickSpotifyEffect = (bars: number, seed: string): EffectStyle => {
  const candidates =
    bars <= 2
      ? SPOTIFY_STYLES.filter((style) => SHORT_SPOTIFY_STYLES.includes(style.id))
      : SPOTIFY_STYLES;
  return candidates[djb2(seed) % candidates.length];
};

export const effectById = (id: number | undefined) =>
  [...EFFECT_STYLES, ...SPOTIFY_STYLES].find((style) => style.id === id);

/** Display name of a plan's effect, whichever kind it is */
export const effectName = (id: number | undefined) =>
  id === CROSSFADE_REVERB.id ? CROSSFADE_REVERB.name : effectById(id)?.name;
