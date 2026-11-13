import { config } from '@/plugins/utils/common/config';

// All fields are edited together in the "Advanced" prompt (see index.ts).
export const crossfadeConfig = {
  /**
   * The duration of the fade in in milliseconds.
   *
   * @default 1500ms
   */
  fadeInDuration: config.number(1500, { min: 0 }),
  /**
   * The duration of the fade out in milliseconds.
   *
   * @default 5000ms
   */
  fadeOutDuration: config.number(5000, { min: 0 }),
  /**
   * How many seconds before the end the crossfade starts.
   *
   * @default 10s
   */
  secondsBeforeEnd: config.number(10, { min: 0 }),
  /**
   * The scaling algorithm to use for the fade.
   * (or a positive number in dB)
   *
   * @default 'linear'
   */
  fadeScaling: config.hidden<'linear' | 'logarithmic' | number>('linear'),
};

export type CrossfadeIpc = {
  invoke: {
    /** The direct audio stream URL of a video. */
    audioUrl(videoID: string): string | undefined;
  };
};
