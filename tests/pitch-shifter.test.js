import vm from 'node:vm';

import { test, expect } from '@playwright/test';

import {
  PROCESSOR_NAME,
  registerPitchShifterProcessor,
} from '../src/plugins/pitch-shifter/processor';

const SAMPLE_RATE = 48000;
const QUANTUM = 128;

// Load the processor the way the renderer does: serialised with toString()
// and evaluated in a scope that only has the AudioWorklet globals.
const loadProcessor = () => {
  let Processor;
  vm.runInNewContext(
    `(${registerPitchShifterProcessor.toString()})(${JSON.stringify(PROCESSOR_NAME)});`,
    {
      sampleRate: SAMPLE_RATE,
      AudioWorkletProcessor: class {},
      registerProcessor: (name, processor) => {
        expect(name).toBe(PROCESSOR_NAME);
        Processor = processor;
      },
    },
  );
  return Processor;
};

const run = (input, semitones) => {
  const processor = new (loadProcessor())();
  const output = new Float32Array(input.length);
  for (let offset = 0; offset + QUANTUM <= input.length; offset += QUANTUM) {
    processor.process(
      [[input.subarray(offset, offset + QUANTUM)]],
      [[output.subarray(offset, offset + QUANTUM)]],
      { semitones: new Float32Array([semitones]) },
    );
  }
  return output;
};

const sine = (frequency, seconds) =>
  Float32Array.from(
    { length: SAMPLE_RATE * seconds },
    (_, i) => 0.5 * Math.sin((2 * Math.PI * frequency * i) / SAMPLE_RATE),
  );

const rms = (signal) =>
  Math.sqrt(
    signal.reduce((sum, value) => sum + value * value, 0) / signal.length,
  );

// Frequency with the most energy between low and high, found by a coarse
// scan of a Hann-windowed DFT followed by a finer search around the maximum.
const dominantFrequency = (signal, low, high) => {
  const windowed = signal.map(
    (value, i) =>
      value * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / signal.length)),
  );
  const power = (frequency) => {
    const step = (2 * Math.PI * frequency) / SAMPLE_RATE;
    let re = 0;
    let im = 0;
    for (let i = 0; i < windowed.length; i++) {
      re += windowed[i] * Math.cos(step * i);
      im -= windowed[i] * Math.sin(step * i);
    }
    return re * re + im * im;
  };
  let best = low;
  for (let frequency = low; frequency <= high; frequency += 1) {
    if (power(frequency) > power(best)) best = frequency;
  }
  for (let step = 0.5; step > 0.01; step /= 2) {
    if (power(best - step) > power(best)) best -= step;
    else if (power(best + step) > power(best)) best += step;
  }
  return best;
};

test.describe('Pitch Shifter processor', () => {
  const input = sine(440, 1);
  // Skip the first half second: the processor latency and fade-in.
  const settled = (signal) =>
    signal.subarray(SAMPLE_RATE / 2, SAMPLE_RATE / 2 + 8192);

  for (const semitones of [-12, -5, -1, 3, 7, 12]) {
    test(`shifts a 440 Hz tone by ${semitones} semitones`, () => {
      const output = settled(run(input, semitones));
      const expected = 440 * 2 ** (semitones / 12);
      const measured = dominantFrequency(
        output,
        Math.floor(expected * 0.9),
        Math.ceil(expected * 1.1),
      );

      const cents = 1200 * Math.log2(measured / expected);
      expect(Math.abs(cents)).toBeLessThan(5);

      const gainDb = 20 * Math.log10(rms(output) / rms(settled(input)));
      expect(gainDb).toBeGreaterThan(-2);
      expect(gainDb).toBeLessThan(0.5);
    });
  }

  test('passes audio through unchanged at 0 semitones', () => {
    const output = run(input, 0);
    // The dry path is delayed by the processor latency (FFT size - hop).
    const latency = 2048 - 512;
    for (let i = SAMPLE_RATE / 2; i < SAMPLE_RATE / 2 + 1024; i++) {
      expect(output[i]).toBeCloseTo(input[i - latency], 6);
    }
  });
});
