export const FETCH_AUDIO_CHANNEL = 'peard:automix-fetch-audio';
export const APPLE_ANALYSIS_CHANNEL = 'peard:automix-apple-analysis';

export interface AppleLookup {
  title: string;
  artist: string;
  /** Length of AutoMix's copy, in seconds; Apple's must be within 2 s */
  duration: number;
}

/** The parts of Apple Music's per-song analysis AutoMix uses, in seconds */
export interface AppleAnalysis {
  /** Apple Music catalog id the analysis belongs to */
  id: string;
  duration: number;
  bpm: { main: number; beginning: number; ending: number };
  key: {
    beginning?: { tonic: string; mode: string };
    ending?: { tonic: string; mode: string };
  };
  beats: number[];
  /** First beat of every bar */
  bars: number[];
  /** Every beat with Apple's structure score: 200 beat, 400 bar, 600+ phrase, 800+ section */
  events: { time: number; score: number }[];
  vocals: { start: number; end: number; strength: VocalStrength }[];
  /** Loudness of 1 s windows every 0.5 s, LUFS-like */
  loudness: number[];
  /** Where the song fades out, when it does */
  fadeOut?: { start: number; end: number };
  /** Entry points Apple tags as the song's salient moment (the hook) */
  salient: number[];
  traits: SongTraits;
  /** Apple's genre names, main genre first (e.g. "Dance", "Music") */
  genres: string[];
}

/** Apple's whole-song ratings, 0..1 (see the planner's beat-match gates) */
export interface SongTraits {
  danceability?: number;
  acousticness?: number;
  melodicness?: number;
}

export type VocalStrength = 'very-low' | 'low' | 'medium' | 'high' | 'very-high';

export interface FetchedAudio {
  bytes: Uint8Array;
  /** Human readable stream description, e.g. "opus 160 kbps" */
  quality: string;
  /** Noticeably worse than what the player streams */
  lowQuality: boolean;
}
