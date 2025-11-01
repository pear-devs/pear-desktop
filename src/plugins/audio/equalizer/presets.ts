export const defaultPresets = ['bass-booster'] as const;
export type Preset = (typeof defaultPresets)[number];

export type FilterConfig = {
  type: BiquadFilterType;
  frequency: number;
  Q: number;
  gain: number;
};

export const presetConfigs: Record<Preset, FilterConfig> = {
  'bass-booster': {
    type: 'lowshelf',
    frequency: 80,
    Q: 100,
    gain: 12.0,
  },
};
