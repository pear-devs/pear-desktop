import type { TransitionPreference } from './planner';

export type AutoMixPluginConfig = {
  enabled: boolean;
  /** AutoMix toggle shown in the player bar (the plugin stays loaded) */
  active: boolean;
  transition: TransitionPreference;
  /** Length of a beat-matched blend, in beats */
  blendBeats: number;
  /** Max time-stretch of the incoming song to match tempos (0.08 = ±8%) */
  maxStretch: number;
  /** Max length of a smooth fade, in seconds */
  smoothSeconds: number;
  /** Play consecutive songs from the same album without transitions */
  respectAlbums: boolean;
  /** Show the "AutoMixing" card while a transition plays */
  showMixCard: boolean;
};

export const defaultConfig: AutoMixPluginConfig = {
  enabled: false,
  active: true,
  transition: 'auto',
  blendBeats: 16,
  maxStretch: 0.08,
  smoothSeconds: 10,
  respectAlbums: true,
  showMixCard: true,
};
