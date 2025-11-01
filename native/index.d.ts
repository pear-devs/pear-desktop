export enum BiquadFilterType {
  Lowpass = 0,
  Highpass = 1,
  Bandpass = 2,
  Lowshelf = 3,
  Highshelf = 4,
  Peaking = 5,
  Notch = 6,
  Allpass = 7,
}

export interface FilterConfig {
  filter_type: BiquadFilterType;
  frequency: number;
  q: number;
  gain: number;
}

export class BiquadFilter {
  constructor(config: FilterConfig, sample_rate: number);
  update_config(config: FilterConfig): void;
  process(input: number): number;
  process_buffer(buffer: number[]): number[];
  reset(): void;
}

export class Equalizer {
  constructor(filter_configs: FilterConfig[], sample_rate: number);
  update_filters(filter_configs: FilterConfig[]): void;
  add_filter(config: FilterConfig): void;
  remove_filter(index: number): boolean;
  process(input: number): number;
  process_buffer(buffer: number[]): number[];
  reset(): void;
  get_filter_count(): number;
}

