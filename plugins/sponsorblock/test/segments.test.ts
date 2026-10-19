import { describe, expect, test } from "vitest";
import { mergeSegments, type Segment, skipTarget, type Submission, usableSegments } from "../segments.ts";

describe("mergeSegments", () => {
  test("sorts disjoint segments", () => {
    expect(mergeSegments([[0, 3], [7, 8], [5, 6]])).toEqual([[0, 3], [5, 6], [7, 8]]);
  });
  test("merges overlapping and touching segments", () => {
    expect(mergeSegments([[0, 5], [6, 8], [4, 6]])).toEqual([[0, 8]]);
    expect(mergeSegments([[0, 6], [7, 8], [4, 6]])).toEqual([[0, 6], [7, 8]]);
  });
  test("does not mutate its input", () => {
    const input: Segment[] = [[3, 9], [0, 5]];
    mergeSegments(input);
    expect(input).toEqual([[3, 9], [0, 5]]);
  });
});

describe("usableSegments", () => {
  const sub = (segment: Segment, extra: Partial<Submission> = {}): Submission => ({
    segment,
    category: "music_offtopic",
    actionType: "skip",
    videoDuration: 200,
    ...extra,
  });
  test("keeps skip segments matching the media duration", () => {
    expect(usableSegments([sub([190, 200], { videoDuration: 201.5 }), sub([0, 10])], 200)).toEqual([[0, 10], [190, 200]]);
  });
  test("drops other action types, empty segments and other cuts of the video", () => {
    expect(
      usableSegments([sub([0, 10], { actionType: "mute" }), sub([5, 5]), sub([20, 30], { videoDuration: 240 })], 200),
    ).toEqual([]);
  });
  test("trusts segments when a duration is unknown", () => {
    expect(usableSegments([sub([0, 10], { videoDuration: 0 })], 200)).toEqual([[0, 10]]);
    expect(usableSegments([sub([0, 10])], 0)).toEqual([[0, 10]]);
  });
});

describe("skipTarget", () => {
  const segments: Segment[] = [[0, 21.8], [249.4, 281.5]];
  test("skips to the end of the segment containing the time", () => {
    expect(skipTarget(segments, 0)).toBe(21.8);
    expect(skipTarget(segments, 10)).toBe(21.8);
    expect(skipTarget(segments, 250)).toBe(281.5);
  });
  test("does nothing outside segments or right before their end", () => {
    expect(skipTarget(segments, 21.8)).toBeUndefined();
    expect(skipTarget(segments, 21.6)).toBeUndefined();
    expect(skipTarget(segments, 100)).toBeUndefined();
    expect(skipTarget([], 5)).toBeUndefined();
  });
});
