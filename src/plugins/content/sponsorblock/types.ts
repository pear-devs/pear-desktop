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
