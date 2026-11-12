/**
 * Apple Music AutoMix's beat-matched effect styles, ported from the style
 * catalog shipped in iOS 27 (_SonicKit_MusicKit, TransitionStyles.json).
 *
 * Each style is a set of automation lanes per song over the transition
 * window. A lane sits in a placement (a part of the window) and ramps one
 * parameter between two values along one of Apple's curves. Tempo lanes are
 * left out: the engine's shared tempo glide already does what they do.
 */

import {
  EQ_STYLES,
  FILTER_STYLES,
  FX_STYLES,
  PRESETS,
  VOLUME_STYLES,
  type CatalogCurve,
} from './spotify-catalog';

import type { HandoffRecipe, TransitionPlan } from './planner';

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
  | 'delayLowpass'
  /**
   * A DJ isolator's low kill: a 24 dB/oct (Linkwitz-Riley) high-pass, 10 Hz
   * when open. Takes the bass out cleanly, unlike a shelf
   */
  | 'lowCut'
  /** ...and its counterpart, a 24 dB/oct low-pass, keeping only the bass */
  | 'highCut'
  /**
   * Spotify's 3-band DJ EQ, raw as Spotify stores it: 0 = kill, 0.5 = flat,
   * 1 = +6 dB (see eqGain)
   */
  | 'eqLow'
  | 'eqMid'
  | 'eqHigh'
  /** Spotify's one-knob DJ filter, raw: 0.5 open, 0 low-pass, 1 high-pass */
  | 'djFilter';

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

export type EffectFamily = 'filter' | 'hiphop' | 'pop' | 'spotify' | 'handoff';

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
  repeats?: {
    at: At;
    bars: number;
    /** The slice ends at the point instead of starting there: the last bars before it */
    behind?: boolean;
  }[];
  /** When the repeater lets go of the song again (default: never) */
  repeatEnd?: At;
  /** When the outgoing song has nothing left to play (default: the end) */
  outEnd?: At;
  /** Lanes may start this long before the window (to cut just ahead of a beat) */
  preroll?: number;
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
type Side = { outgoing: Lane[]; incoming: Lane[] };

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
  if (
    !at ||
    style.family === 'handoff' ||
    !style.outgoing.some((item) => item.param === 'bass')
  ) {
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

/**
 * How long Spotify's instant steps take here, in seconds. Its curves jump
 * (a volume dropping dead, a band killed in 1/128 of the window), which
 * through a short blend lands as three hard edges within a second or two:
 * the shapes and timing are kept, the edges are rounded off
 */
const STEP_SECONDS: Partial<Record<EffectParam, number>> = { gain: 1.2 };
const STEP_SECONDS_DEFAULT = 0.6;

/** A Spotify catalog curve as lanes on one parameter */
const curveLanes = (param: EffectParam, curve: CatalogCurve): Lane[] => {
  const lanes: Lane[] = [];
  const soften = STEP_SECONDS[param] ?? STEP_SECONDS_DEFAULT;
  for (let i = 0; i + 3 < curve.length; i += 2) {
    const [x0, y0, x1, y1] = curve.slice(i, i + 4);
    // A step (or a near-instant ramp) becomes a short, smooth move centred
    // on it: equal-power on the volume, so a swap doesn't dip or bump
    // Holds add nothing (a value stays where its last move left it) and
    // would cut into a softened step's ramp: only the start value is kept
    if (y0 === y1) {
      if (lanes.length === 0) lanes.push(set(param, y0, x0));
      continue;
    }
    const instant = x1 - x0 < 0.02;
    if (instant) {
      const centre = (x0 + x1) / 2;
      const curveKind = param === 'gain' ? (y1 > y0 ? 'out-0.5' : 'in-0.5') : 'linear';
      lanes.push(lane(param, y0, y1, curveKind, [0, 1], [[centre, -soften / 2], [centre, soften / 2]]));
    } else {
      lanes.push(lane(param, y0, y1, 'linear', [0, 1], [x0, x1]));
    }
  }
  return lanes;
};

/** The EQ lanes of one of Spotify's EQ styles, both songs */
export const catalogEq = (id: number): Side => {
  const eq = EQ_STYLES[id];
  if (!eq) return { outgoing: [], incoming: [] };
  return {
    outgoing: [
      ...curveLanes('eqLow', eq.lowOut),
      ...curveLanes('eqMid', eq.midOut),
      ...curveLanes('eqHigh', eq.highOut),
    ],
    incoming: [
      ...curveLanes('eqLow', eq.lowIn),
      ...curveLanes('eqMid', eq.midIn),
      ...curveLanes('eqHigh', eq.highIn),
    ],
  };
};

/** A catalog curve with its values mapped */
const mapCurve = (curve: CatalogCurve, map: (y: number) => number): CatalogCurve =>
  curve.map((value, i) => (i % 2 ? map(value) : value));

/** Reverb tail of Spotify's reverb sends, seconds */
const SPOTIFY_REVERB_SECONDS = 4;

/**
 * The old song's effect send of a Spotify fx style: its dry/wet (0..1 =
 * 0..100 % wet) as the send into an echo or reverb and the dry level
 */
const fxLanes = (id: number): Lane[] => {
  const fx = FX_STYLES[id];
  if (!fx) return [];
  const lanes = [
    set('wet', 1),
    ...curveLanes('send', mapCurve(fx.out, (wet) => Math.min(1, wet * 2))),
    ...curveLanes('dry', mapCurve(fx.out, (wet) => 1 - wet)),
  ];
  if (fx.kind !== 'reverb') {
    // An echo keeps repeating and fades; a delay is a shorter tail
    lanes.push(
      set('delayMix', 1),
      set('delayFeedback', fx.kind === 'echo' ? 0.5 : 0.3),
      set('delayLowpass', 5000),
    );
  }
  return lanes;
};

/** One of Spotify's presets, exactly as its catalog defines it */
const catalogPreset = (id: number): EffectStyle => {
  const preset = PRESETS[id];
  const volumeStyle = VOLUME_STYLES[preset.volume];
  const filter = FILTER_STYLES[preset.filter];
  const eq = catalogEq(preset.eq);
  const fx = FX_STYLES[preset.fx];
  return {
    id: 100 + id,
    name: preset.name.replace(/([a-z])([A-Z])/g, '$1 $2'),
    family: 'spotify',
    bars: 4,
    delay: fx ? fx.kind !== 'reverb' : undefined,
    reverb: fx?.kind === 'reverb' ? SPOTIFY_REVERB_SECONDS : undefined,
    outgoing: [
      ...(volumeStyle ? curveLanes('gain', volumeStyle.out) : []),
      ...eq.outgoing,
      ...(filter ? curveLanes('djFilter', filter.out) : []),
      ...fxLanes(preset.fx),
    ],
    incoming: [
      ...(volumeStyle ? curveLanes('gain', volumeStyle.in) : []),
      ...eq.incoming,
      ...(filter ? curveLanes('djFilter', filter.in) : []),
    ],
  };
};

/**
 * The presets Spotify's planner picks from for beat-matched blends, from its
 * own catalog (the cuts and the echo / reverb / riser presets aren't blends
 * AutoMix plays this way)
 */
export const SPOTIFY_STYLES: EffectStyle[] = [
  1, 2, 3, 4, 5, 7, 8, 9, 10, 16, 17, 18, 19,
  // ...and the ones with an effect send: Dissolve (echo), Surge and
  // Afterglow (reverb)
  20, 21, 22,
].map(catalogPreset);

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
  lowCut: 10,
  highCut: 20_000,
  eqLow: 0.5,
  eqMid: 0.5,
  eqHigh: 0.5,
  djFilter: 0.5,
};

/**
 * Spotify's EQ value mapping (its AutomationValueSemantics): 0 kills the
 * band, 0 .. 0.5 is -48 .. -1.5 dB geometric, 0.5 flat, 0.5 .. 1 is
 * +0.64 .. +6 dB geometric. Returns the band's linear gain.
 */
export const eqGain = (raw: number) => {
  if (raw <= 0) return 0;
  if (Math.abs(raw - 0.5) < 1e-6) return 1;
  const db =
    raw < 0.5
      ? -48 * ((1.5 / 48) ** (raw / 0.5))
      : 0.638_943 * ((6 / 0.638_943) ** ((raw - 0.5) / 0.5));
  return 10 ** (db / 20);
};

/** Spotify's filter knob, low-pass side: 120 Hz (0) .. 16 kHz (0.5), open above */
export const djLowpass = (raw: number) =>
  raw >= 0.5 ? 20_000 : 120 * ((16_000 / 120) ** (Math.max(0, raw) / 0.5));
/** ...and high-pass side: open below 0.5, 20 Hz (0.5) .. 9 kHz (1) */
export const djHighpass = (raw: number) =>
  raw <= 0.5 ? 10 : 20 * ((9000 / 20) ** (Math.min(1, raw - 0.5) / 0.5));

/** Raw lane values turned into what each AudioParam takes */
const PARAM_MAP: Partial<Record<EffectParam, (raw: number) => number>> = {
  eqLow: eqGain,
  eqMid: eqGain,
  eqHigh: eqGain,
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
  params: Partial<Record<EffectParam, AudioParam | AudioParam[]>>,
  lanes: Lane[],
  start: number,
  duration: number,
  side: 'outgoing' | 'incoming',
  /** Lanes may reach this far before the window start */
  preroll = 0,
) => {
  const earliest = start - preroll;
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
  const all = (given: AudioParam | AudioParam[] | undefined) =>
    Array.isArray(given) ? given : given ? [given] : [];
  for (const [name, items] of byParam) {
    if (name === 'djFilter') {
      // One knob drives both filters
      for (const param of all(params.lowpass)) {
        scheduleParam(param, items, start, duration, earliest, 0.5, djLowpass);
      }
      for (const param of all(params.highpass)) {
        scheduleParam(param, items, start, duration, earliest, 0.5, djHighpass);
      }
      continue;
    }
    for (const param of all(params[name])) {
      scheduleParam(param, items, start, duration, earliest, neutral(name), PARAM_MAP[name]);
    }
  }
};

/** One parameter's lanes, in order (see scheduleLanes) */
const scheduleParam = (
  param: AudioParam,
  items: Lane[],
  start: number,
  duration: number,
  earliest: number,
  neutralValue: number,
  map: (raw: number) => number = (raw) => raw,
) => {
  const clamp = (value: number) =>
    Math.min(param.maxValue, Math.max(param.minValue, map(value)));
  const timed = items
    .map((item) => ({ item, times: laneTimes(item, start, duration) }))
    .sort((a, b) => a.times.from - b.times.from);
  param.cancelScheduledValues(earliest);
  param.setValueAtTime(clamp(neutralValue), earliest);
  const first = timed[0];
  param.setValueAtTime(
    clamp(first.item.from),
    Math.max(earliest, Math.min(first.times.placed, first.times.from)),
  );
  for (const { item, times } of timed) {
    const { from, to } = times;
    param.setValueAtTime(clamp(item.from), Math.max(earliest, from));
    if (to <= from) {
      param.setValueAtTime(clamp(item.to), Math.max(earliest, from));
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
  if (bars <= 2) {
    const short = SPOTIFY_STYLES.filter((style) => SHORT_SPOTIFY_STYLES.includes(style.id));
    return short[djb2(seed) % short.length];
  }
  // Weighted the way Spotify's own planner picks for beat-matched pairs
  // (its GetComputedTransitions over 48 pairs of rap and Bollywood)
  const pool = SPOTIFY_PICKS.flatMap(([id, weight]) => Array.from({ length: weight }, () => id));
  const id = pool[djb2(seed) % pool.length];
  return SPOTIFY_STYLES.find((style) => style.id === id) ?? SPOTIFY_STYLES[0];
};

/** Spotify preset id (+100) and how often Spotify chose it for a beat-matched pair */
const SPOTIFY_PICKS: [number, number][] = [
  [110, 6], // Filter Fade In Out
  [109, 4], // Filter Fade In
  [101, 4], // Simple Fade
  [108, 3], // Filter Fade Out
  [117, 3], // Bass Swap Low Pass Filter In
  [103, 1], // Bass Swap
  // Not in that sample, but Spotify offers them: now and then
  [102, 1], // Eq Swap (all three bands swap)
  [104, 1], // Bass Swap Filter In
  [105, 1], // Bass Swap Filter Out
  [107, 1], // Bass And Mid Swap
  [116, 1], // Bass Swap At End
  [118, 1], // Bass Swap Low Pass Filter Out
  [119, 1], // Low Pass Filter Fade In Out
  [120, 1], // Dissolve
  [121, 1], // Surge
  [122, 1], // Afterglow
];

export const effectById = (id: number | undefined) =>
  [...EFFECT_STYLES, ...SPOTIFY_STYLES].find((style) => style.id === id);

/** Where a DJ isolator splits the bass off (~300 Hz, 24 dB/oct) */
const ISOLATOR_HZ = 300;
/** How long an isolator switch takes, either side of the bar line */
const SWITCH = 0.025;

const HANDOFF_NAMES: Record<HandoffRecipe['kind'], string> = {
  pickup: 'Pickup hand-off',
  outro: 'Outro swap',
  loop: 'Loop swap',
};

/**
 * The lanes of a DJ hand-off (see handoff.ts and HandoffRecipe): both songs
 * at full level, the bass handed over with an isolator on a bar line
 */
export const handoffStyle = (recipe: HandoffRecipe): EffectStyle => {
  if (recipe.kind === 'loop') {
    // The old song's last full bar(s) before its exit loop on (Spotify's
    // looping styles), carrying the beat under the next song's way in; the
    // bass goes over with one of Spotify's EQ styles; the loop stops at the
    // end of the window
    return {
      id: 203,
      name: HANDOFF_NAMES.loop,
      family: 'handoff',
      bars: recipe.bars,
      // ...rolling over its last quarter like Spotify's beat roll (looping
      // style 5): the slice shortens to a beat, half a beat, a quarter
      repeats: [
        { at: 0, bars: recipe.loopBeats / 4, behind: true },
        { at: 0.75, bars: 1 / 4 },
        { at: 0.875, bars: 1 / 8 },
        { at: 0.9375, bars: 1 / 16 },
      ],
      repeatEnd: [1, 0.01],
      outEnd: [0, 0.05],
      outgoing: [
        ...catalogEq(recipe.eq).outgoing,
        lane('gain', 1, 0, 'linear', [0, 1], [[1, -0.01], [1, 0.005]]),
      ],
      incoming: [
        lane('gain', 0, 1, 'linear', [0, 1], [0, [0, 0.008]]),
        ...catalogEq(recipe.eq).incoming,
      ],
    };
  }
  if (recipe.kind === 'outro') {
    // Both at full level (Spotify's FullOverlap); the bass goes over with
    // one of Spotify's EQ styles; the old song stops on its last beat
    return {
      id: 202,
      name: HANDOFF_NAMES.outro,
      family: 'handoff',
      bars: recipe.bars,
      outEnd: [1, 0.01],
      outgoing: [
        ...catalogEq(recipe.eq).outgoing,
        lane('gain', 1, 0, 'linear', [0, 1], [[1, -0.01], [1, 0.005]]),
      ],
      incoming: [
        lane('gain', 0, 1, 'linear', [0, 1], [0, [0, 0.008]]),
        ...catalogEq(recipe.eq).incoming,
      ],
    };
  }

  const { gapBars: gap, overlapBars: overlap, afterBars } = recipe;
  const u = 1 / (gap + overlap + afterBars);
  const bar = (bars: number, seconds = 0): At => [bars * u, seconds];
  const swap = gap + overlap;
  const outgoing: Lane[] = [];
  if (gap) {
    // Cut just ahead of the downbeat that ends the breakdown: nothing rings
    outgoing.push(lane('gain', 1, 0, 'linear', [0, 1], [bar(0, -0.015), bar(0, -0.005)]));
  }
  if (overlap) {
    // One bar of only the old song's kick and bass under the new song
    if (gap) {
      outgoing.push(
        set('highCut', ISOLATOR_HZ, bar(gap, -0.06)),
        lane('gain', 0, 1, 'linear', [0, 1], [bar(gap, -0.04), bar(gap)]),
      );
    } else {
      outgoing.push(
        lane('highCut', 20_000, ISOLATOR_HZ, 'log', [0, 1], [bar(0, -0.03), bar(0)]),
      );
    }
    outgoing.push(
      lane('gain', 1, 0, 'linear', [0, 1], [bar(swap, -SWITCH), bar(swap, SWITCH)]),
    );
  } else if (!gap) {
    outgoing.push(lane('gain', 1, 0, 'linear', [0, 1], [bar(0, -0.015), bar(0, 0.005)]));
  }

  // The new song from its first note, at full level, with no bass of its
  // own while the old one carries the beat
  const incoming: Lane[] = [lane('gain', 0, 1, 'linear', [0, 1], [0, [0, 0.005]])];
  if (overlap) {
    incoming.push(
      lane('lowCut', 10, ISOLATOR_HZ, 'log', [0, 1], [bar(gap, -0.12), bar(gap, -0.08)]),
      lane('lowCut', ISOLATOR_HZ, 10, 'log', [0, 1], [bar(swap, -SWITCH), bar(swap, SWITCH)]),
    );
  }
  return {
    id: 201,
    name: HANDOFF_NAMES.pickup,
    family: 'handoff',
    bars: gap + overlap + afterBars,
    outEnd: bar(swap, 0.05),
    preroll: 0.1,
    outgoing,
    incoming,
  };
};

/** The effect style a plan is dressed in, if any (a hand-off's own lanes) */
export const styleOf = (plan: TransitionPlan) => {
  if (plan.style !== 'blend') return undefined;
  return plan.recipe ? handoffStyle(plan.recipe) : effectById(plan.effect);
};

/** Display name of a plan's effect, whichever kind it is */
export const effectName = (id: number | undefined) =>
  id === CROSSFADE_REVERB.id
    ? CROSSFADE_REVERB.name
    : id === 201
      ? HANDOFF_NAMES.pickup
      : id === 202
        ? HANDOFF_NAMES.outro
        : id === 203
          ? HANDOFF_NAMES.loop
          : effectById(id)?.name;
