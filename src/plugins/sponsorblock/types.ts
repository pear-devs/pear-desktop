import { config } from '@/plugins/utils/common/config';

export const sponsorBlockConfig = {
  apiURL: config.string('https://sponsor.ajay.app'),
  categories: config.multi(
    ['sponsor', 'intro', 'outro', 'interaction', 'selfpromo', 'music_offtopic'],
    [
      { value: 'sponsor' },
      { value: 'intro' },
      { value: 'outro' },
      { value: 'interaction' },
      { value: 'selfpromo' },
      { value: 'music_offtopic' },
    ],
  ),
};

export type SponsorBlockIpc = {
  toRenderer: {
    /** The segments to skip in the video that just loaded. */
    skip: [segments: Segment[]];
  };
};

export type Segment = [number, number];

export interface SkipSegment {
  // Array of this object
  segment: Segment; //[0, 15.23] start and end time in seconds
  UUID: string;
  category: string; // [1]
  videoDuration: number; // Duration of video when submission occurred (to be used to determine when a submission is out of date). 0 when unknown. +- 1 second
  actionType: string; // [3]
  locked: number; // if submission is locked
  votes: number; // Votes on segment
  description: string; // title for chapters, empty string for other segments
}
