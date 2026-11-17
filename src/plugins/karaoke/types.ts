export type LyricsSize = 'small' | 'medium' | 'large';

export type KaraokePluginConfig = {
  enabled: boolean;
  /** How much of the vocals to remove, from 0 to 1. */
  vocalReduction: number;
  lyricsSize: LyricsSize;
  /** Separate vocals with an AI model on the GPU, instead of only the filter. */
  aiVocals: boolean;
  /** Serve a page that lets a phone show lyrics and control playback. */
  phoneRemote: boolean;
};
