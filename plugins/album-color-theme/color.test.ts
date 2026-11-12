import { describe, expect, test } from "vitest";
import { averageColor, darken, formatRgb, luminance, themeColors } from "./color.ts";

describe("averageColor", () => {
  test("weights by alpha and ignores transparent pixels", () => {
    const pixels = [255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 0];
    expect(averageColor(pixels)).toEqual([180, 0, 180]);
  });
  test("is undefined for a fully transparent image", () => {
    expect(averageColor([1, 2, 3, 0])).toBeUndefined();
  });
});

describe("darken", () => {
  test("scales lightness and keeps the hue", () => {
    const [r, g, b] = darken([200, 100, 100], 0.5);
    expect(r).toBeCloseTo(110.7, 0);
    expect(g).toBeCloseTo(39.3, 0);
    expect(b).toBe(g);
  });
  test("handles grays", () => {
    expect(darken([100, 100, 100], 0.5)).toEqual([50, 50, 50]);
  });
});

describe("themeColors", () => {
  test("bright artwork ends up dark enough for white text", () => {
    const { color, dark } = themeColors([250, 250, 240]);
    expect(luminance(color)).toBeLessThanOrEqual(0.5);
    expect(luminance(dark)).toBeLessThan(luminance(color));
  });
  test("dark artwork is only slightly darkened", () => {
    expect(formatRgb(themeColors([40, 60, 120]).color)).toBe("34, 51, 102");
  });
});
