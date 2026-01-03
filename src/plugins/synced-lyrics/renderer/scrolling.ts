export const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));

// scroll timing config
// FAST_* is for quick scrolls (feels snappy, not abrupt)
const FAST_SCROLL_BASE_MS = 260; // tuned for fast transitions
const FAST_SCROLL_MULTIPLIER = 0.28; // lower = less inertia
const FAST_SCROLL_MIN_MS = 240; // don't let FAST_* scrolls get too short
const FAST_SCROLL_MAX_MS = 680; // cap FAST_* scroll time for long jumps

// NORMAL_* is for regular smooth scrolling
const NORMAL_SCROLL_BASE_MS = 550; // feels natural for single-line
const NORMAL_SCROLL_MULTIPLIER = 0.7; // higher = more visible animation
const NORMAL_SCROLL_MIN_MS = 850;
const NORMAL_SCROLL_MAX_MS = 1650;

// JUMP1_* is for jumps of exactly 1 line (slightly slower for emphasis)
const JUMP1_SCROLL_BASE_MS = 700;
const JUMP1_SCROLL_MULTIPLIER = 0.8;
const JUMP1_SCROLL_MIN_MS = 1000;
const JUMP1_SCROLL_MAX_MS = 1800;

// JUMP4_* is for jumps of 4+ lines (faster so you don't wait forever)
const JUMP4_SCROLL_BASE_MS = 400;
const JUMP4_SCROLL_MULTIPLIER = 0.6;
const JUMP4_SCROLL_MIN_MS = 600;
const JUMP4_SCROLL_MAX_MS = 1400;

export const SCROLL_DURATION = {
  FAST_BASE: FAST_SCROLL_BASE_MS,
  FAST_MULT: FAST_SCROLL_MULTIPLIER,
  FAST_MIN: FAST_SCROLL_MIN_MS,
  FAST_MAX: FAST_SCROLL_MAX_MS,
  NORMAL_BASE: NORMAL_SCROLL_BASE_MS,
  NORMAL_MULT: NORMAL_SCROLL_MULTIPLIER,
  NORMAL_MIN: NORMAL_SCROLL_MIN_MS,
  NORMAL_MAX: NORMAL_SCROLL_MAX_MS,
  JUMP1_BASE: JUMP1_SCROLL_BASE_MS,
  JUMP1_MULT: JUMP1_SCROLL_MULTIPLIER,
  JUMP1_MIN: JUMP1_SCROLL_MIN_MS,
  JUMP1_MAX: JUMP1_SCROLL_MAX_MS,
  JUMP4_BASE: JUMP4_SCROLL_BASE_MS,
  JUMP4_MULT: JUMP4_SCROLL_MULTIPLIER,
  JUMP4_MIN: JUMP4_SCROLL_MIN_MS,
  JUMP4_MAX: JUMP4_SCROLL_MAX_MS,
} as const;

// LEAD_IN_TIME_MS: how early to start scroll before next line (ms)
// 130ms allows the scroll animation to start smoothly before the next line becomes active
// lets the scroll feel smooth and not rushed
export const LEAD_IN_TIME_MS = 130;
