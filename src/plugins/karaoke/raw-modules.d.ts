declare module '*.worklet.js?raw' {
  const source: string;
  export default source;
}

declare module '*.mjs?raw' {
  const source: string;
  export default source;
}

declare module 'demucs-web/constants' {
  export const CONSTANTS: {
    SAMPLE_RATE: number;
    TRAINING_SAMPLES: number;
    MODEL_SPEC_BINS: number;
    MODEL_SPEC_FRAMES: number;
    SEGMENT_OVERLAP: number;
  };
}

declare module 'demucs-web/processor' {
  type StereoSpectrum = {
    leftReal: Float32Array;
    leftImag: Float32Array;
    rightReal: Float32Array;
    rightImag: Float32Array;
  };

  export const prepareModelInput: (
    left: Float32Array,
    right: Float32Array,
  ) => { waveform: Float32Array; magSpec: Float32Array };

  export const standaloneIspec: (
    spectrum: StereoSpectrum,
    length: number,
  ) => { left: Float32Array; right: Float32Array };
}
