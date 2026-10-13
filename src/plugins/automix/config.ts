import type { TransitionPreference } from './planner';

export type AutoMixPluginConfig = {
  enabled: boolean;
  /** AutoMix toggle shown in the player bar (the plugin stays loaded) */
  active: boolean;
  transition: TransitionPreference;
  /** Length of a beat-matched blend, in beats */
  blendBeats: number;
  /** Max time-stretch of the incoming song to match tempos (0.05 = ±5%) */
  maxStretch: number;
  /** Max length of a smooth fade, in seconds */
  smoothSeconds: number;
  /** Never segue: always beat-match, or cut on the beat */
  beatOnly: boolean;
  /** Echo the old song's last beat under the next one on a beat cut */
  cutEcho: boolean;
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
  maxStretch: 0.05,
  smoothSeconds: 10,
  beatOnly: false,
  cutEcho: false,
  respectAlbums: true,
  showMixCard: true,
};
