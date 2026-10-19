// Lightweight 2D canvas visualizers (successors of the original's vudio and
// wave options), drawn from an AnalyserNode once per frame.

export interface CanvasOptions {
  bars: number;
  primary: string;
  secondary: string;
}

export interface Frame {
  frequency: Uint8Array<ArrayBuffer>;
  waveform: Uint8Array<ArrayBuffer>;
}

export type Draw = (g: CanvasRenderingContext2D, frame: Frame, options: CanvasOptions) => void;

/** Averages `count` log-spaced bands of the spectrum to 0–1, skipping the empty top end. */
function bands(frequency: Uint8Array, count: number) {
  const usable = Math.floor(frequency.length * 0.7);
  const result = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const from = Math.floor(usable ** (i / count));
    const to = Math.max(from + 1, Math.floor(usable ** ((i + 1) / count)));
    let sum = 0;
    for (let j = from; j < to; j++) sum += frequency[j]!;
    result[i] = sum / (to - from) / 255;
  }
  return result;
}

function gradient(g: CanvasRenderingContext2D, options: CanvasOptions, x0: number, y0: number, x1: number, y1: number) {
  const fill = g.createLinearGradient(x0, y0, x1, y1);
  fill.addColorStop(0, options.primary);
  fill.addColorStop(1, options.secondary);
  return fill;
}

/** Mirrored, dotted bars around the horizontal center line. */
export const drawBars: Draw = (g, { frequency }, options) => {
  const { width, height } = g.canvas;
  const levels = bands(frequency, options.bars);
  g.clearRect(0, 0, width, height);
  const slot = width / options.bars;
  const size = Math.max(2, slot * 0.6);
  const middle = height / 2;
  const maxHeight = height * 0.4;
  g.fillStyle = gradient(g, options, 0, middle - maxHeight, 0, middle + maxHeight);
  g.shadowColor = options.primary;
  g.shadowBlur = size;
  for (let i = 0; i < options.bars; i++) {
    const h = Math.max(size, levels[i]! * maxHeight);
    const x = i * slot + (slot - size) / 2;
    // Dots instead of solid bars, like vudio's "dottify".
    for (let y = 0; y < h; y += size * 1.6) {
      g.beginPath();
      g.roundRect(x, middle - y - size, size, size, size / 2);
      g.roundRect(x, middle + y, size, size, size / 2);
      g.fill();
    }
  }
  g.shadowBlur = 0;
};

/** A pulsing spectrum ring with the waveform across the bottom. */
export const drawWave: Draw = (g, { frequency, waveform }, options) => {
  const { width, height } = g.canvas;
  const levels = bands(frequency, options.bars);
  g.clearRect(0, 0, width, height);
  const cx = width / 2;
  const cy = height * 0.45;
  const bass = (levels[0]! + levels[1]! + levels[2]!) / 3;
  const radius = Math.min(width, height) * (0.16 + bass * 0.06);
  const spike = Math.min(width, height) * 0.22;

  g.lineCap = "round";
  g.lineWidth = Math.max(2, (Math.PI * 2 * radius) / options.bars / 2.5);
  g.strokeStyle = gradient(g, options, cx - radius, cy - radius, cx + radius, cy + radius);
  g.beginPath();
  for (let i = 0; i < options.bars; i++) {
    const angle = (i / options.bars) * Math.PI * 2 - Math.PI / 2;
    const length = 2 + levels[i]! * spike;
    g.moveTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
    g.lineTo(cx + Math.cos(angle) * (radius + length), cy + Math.sin(angle) * (radius + length));
  }
  g.stroke();

  g.lineWidth = Math.max(2, height / 200);
  g.beginPath();
  g.arc(cx, cy, radius * 0.92, 0, Math.PI * 2);
  g.stroke();

  g.strokeStyle = gradient(g, options, 0, 0, width, 0);
  g.beginPath();
  const base = height * 0.88;
  const amplitude = height * 0.08;
  for (let i = 0; i < waveform.length; i++) {
    const x = (i / (waveform.length - 1)) * width;
    const y = base + ((waveform[i]! - 128) / 128) * amplitude;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();
};
