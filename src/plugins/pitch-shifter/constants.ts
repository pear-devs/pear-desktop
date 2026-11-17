export const MIN_SEMITONES = -12;
export const MAX_SEMITONES = 12;

export const clampSemitones = (value: number) =>
  Number.isFinite(value)
    ? Math.min(MAX_SEMITONES, Math.max(MIN_SEMITONES, Math.round(value)))
    : 0;

export const formatSemitones = (value: number) =>
  value > 0 ? `+${value}` : `${value}`;
