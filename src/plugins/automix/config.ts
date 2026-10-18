import type { TransitionPreference } from './planner';
import type { ReorderShape } from './reorder';

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
  /** Dress beat-matched blends in Apple Music's effect styles (filters, echoes, reverb) */
  effects: boolean;
  /**
   * Mix like Spotify: blends use its presets (bass swap at the midpoint,
   * filter sweeps) and avoid overlapping two singers. Overrides `effects`.
   */
  spotifyStyle: boolean;
  /** Play consecutive songs from the same album without transitions */
  respectAlbums: boolean;
  /** Show the "AutoMixing" card while a transition plays */
  showMixCard: boolean;
  /** Cross-fade the songs' artwork along with the audio while mixing */
  artworkFade: boolean;
  /**
   * Look songs up in Apple Music's catalog and use its analysis (beat grid,
   * phrases, where the singing starts) to plan transitions
   */
  appleAnalysis: boolean;
  /** How Reorder shapes the set: smoothest, building up, or steady */
  reorderShape: ReorderShape;
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
  effects: true,
  spotifyStyle: false,
  respectAlbums: true,
  showMixCard: true,
  artworkFade: true,
  appleAnalysis: true,
  reorderShape: 'smooth',
};
