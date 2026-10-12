export const FETCH_AUDIO_CHANNEL = 'peard:automix-fetch-audio';

export interface FetchedAudio {
  bytes: Uint8Array;
  /** Human readable stream description, e.g. "opus 160 kbps" */
  quality: string;
  /** Noticeably worse than what the player streams */
  lowQuality: boolean;
}
