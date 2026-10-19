// Just enough color math for the theme: averaging artwork pixels and darkening
// the result until it is dark enough to sit behind white text.

export type Rgb = readonly [r: number, g: number, b: number];

/**
 * Average of RGBA pixels, weighted by alpha. Squares are averaged (then rooted)
 * so the result matches how the image looks rather than its raw sRGB numbers.
 */
export function averageColor(pixels: ArrayLike<number>): Rgb | undefined {
  let r = 0;
  let g = 0;
  let b = 0;
  let weight = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const a = pixels[i + 3]! / 255;
    if (a === 0) continue;
    r += pixels[i]! ** 2 * a;
    g += pixels[i + 1]! ** 2 * a;
    b += pixels[i + 2]! ** 2 * a;
    weight += a;
  }
  if (weight === 0) return;
  return [Math.sqrt(r / weight), Math.sqrt(g / weight), Math.sqrt(b / weight)].map(Math.round) as unknown as Rgb;
}

/** WCAG relative luminance, 0–1. */
export function luminance([r, g, b]: Rgb) {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Scales HSL lightness by `1 - amount`, keeping hue and saturation. */
export function darken(color: Rgb, amount: number): Rgb {
  const [h, s, l] = toHsl(color);
  return fromHsl(h, s, l * (1 - amount));
}

/** The base and dark theme colors for an artwork's average color. */
export function themeColors(average: Rgb): { color: Rgb; dark: Rgb } {
  let color = darken(average, 0.15);
  let dark = darken(average, 0.3);
  for (let i = 0; i < 100 && luminance(color) > 0.5; i++) {
    color = darken(color, 0.05);
    dark = darken(dark, 0.05);
  }
  return { color, dark };
}

export const formatRgb = (color: Rgb) => color.map((c) => Math.round(c)).join(", ");

function toHsl([r, g, b]: Rgb): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  return [h / 6, s, l];
}

function fromHsl(h: number, s: number, l: number): Rgb {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number) => {
    const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [hue(h + 1 / 3) * 255, hue(h) * 255, hue(h - 1 / 3) * 255];
}
