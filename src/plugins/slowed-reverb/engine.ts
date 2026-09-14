/* oxlint-disable @stylistic/no-mixed-operators */
export const SLOW_MIN = 0.7;
export const SLOW_MAX = 1.3;
export const INTENSITY_MIN = 0;
export const INTENSITY_MAX = 1;

export function clamp(value: number, min: number, max: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(max, Math.max(min, numeric));
}

export function clampSlow(value: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.round(clamp(numeric, SLOW_MIN, SLOW_MAX) * 100) / 100;
}

export function clampIntensity(value: number): number {
  return Math.round(clamp(value, INTENSITY_MIN, INTENSITY_MAX) * 100) / 100;
}

export function normalize(raw: unknown): {
  slow: number;
  reverbIntensity: number;
} {
  const next =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    slow: clampSlow(
      Object.prototype.hasOwnProperty.call(next, 'slow')
        ? (next['slow'] as number)
        : 1,
    ),
    reverbIntensity: clampIntensity(
      Object.prototype.hasOwnProperty.call(next, 'reverbIntensity')
        ? (next['reverbIntensity'] as number)
        : 0,
    ),
  };
}

export function formatRate(value: number): string {
  return `${clampSlow(value).toFixed(2)}x`;
}

export function formatPercent(value: number): string {
  return `${Math.round(clampIntensity(value) * 100)}%`;
}

export interface DattorroParams {
  wetGain: number;
  decay: number;
  damping: number;
  preDelay: number;
  preFilter?: number;
  inputDiff1?: number;
  inputDiff2?: number;
  decayDiff1?: number;
}

export function computeDattorroParams(intensity: number): DattorroParams {
  const i = clamp(intensity, INTENSITY_MIN, INTENSITY_MAX);
  if (i <= 0) {
    return { wetGain: 0, decay: 0, damping: 1, preDelay: 0 };
  }
  return {
    preDelay: 0.44 + i * 0.1,
    preFilter: 0.7 + i * 0.1,
    inputDiff1: 0.75,
    inputDiff2: 0.625,
    decayDiff1: 0.65 + i * 0.05,
    decay: Math.pow(i, 0.75) * 0.58,
    damping: Math.min(0.5 + Math.pow(i, 0.6) * 0.4, 0.78),
    wetGain: Math.pow(i, 0.75) * 0.42,
  };
}
