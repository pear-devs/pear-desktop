import { describe, expect, test } from "vitest";
import { adStrategy, rewindTarget } from "../ads.ts";

describe("adStrategy", () => {
  test("seeks through a standalone ad that is clearly shorter than the track", () => {
    expect(adStrategy(15, 212)).toBe("seek");
    expect(adStrategy(30.5, 180)).toBe("seek");
  });
  test("only fast-forwards stitched streams, which are longer than the track", () => {
    expect(adStrategy(227, 212)).toBe("fast-forward");
  });
  test("only fast-forwards when unsure", () => {
    expect(adStrategy(Number.NaN, 212)).toBe("fast-forward");
    expect(adStrategy(Infinity, 212)).toBe("fast-forward");
    expect(adStrategy(15, 0)).toBe("fast-forward");
    expect(adStrategy(211, 212)).toBe("fast-forward");
  });
});

describe("rewindTarget", () => {
  test("rewinds track time that ran by at ad speed", () => {
    expect(rewindTarget(0, 6.4)).toBe(0);
    expect(rewindTarget(42, 50)).toBe(42);
  });
  test("leaves normal resumes and deliberate starts alone", () => {
    expect(rewindTarget(0, 0.3)).toBeUndefined();
    expect(rewindTarget(42, 43)).toBeUndefined();
    // e.g. a shared link with &t=90 after a pre-roll
    expect(rewindTarget(0, 90)).toBeUndefined();
  });
});
