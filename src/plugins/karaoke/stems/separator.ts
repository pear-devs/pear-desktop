import { CONSTANTS } from 'demucs-web/constants';
import { prepareModelInput, standaloneIspec } from 'demucs-web/processor';
import runtimeGlue from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?raw';

import runtimeSource from '@/../node_modules/onnxruntime-web/dist/ort.webgpu.min.mjs?raw';

import type * as Ort from 'onnxruntime-web/webgpu';

const { MODEL_SPEC_BINS, MODEL_SPEC_FRAMES, TRAINING_SAMPLES } = CONSTANTS;

// The model outputs drums, bass, other and vocals, in that order.
const VOCALS_TRACK = 3;
const TIME_OUTPUT_RANK = 4;

const createScriptUrl = (source: string) =>
  URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));

// Loaded on demand, because importing it normally would pull a 28 MB binary into
// the page script. The backend supplies that binary instead.
const importRuntime = async () => {
  const url = createScriptUrl(runtimeSource);
  try {
    return (await import(/* @vite-ignore */ url)) as typeof Ort;
  } finally {
    URL.revokeObjectURL(url);
  }
};

let runtime: Promise<typeof Ort> | null = null;

/** Runs the model, one segment at a time. */
export class Separator {
  private lastRun: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly ort: typeof Ort,
    private readonly session: Ort.InferenceSession,
  ) {}

  static async create(wasm: Uint8Array, model: Uint8Array) {
    if (!('gpu' in navigator)) throw new Error('WebGPU is not available');

    runtime ??= importRuntime();
    const ort = await runtime;

    // The page is not cross-origin isolated, so threads are not an option. The
    // heavy work is on the GPU, which makes that a small cost.
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmBinary = wasm;

    const glue = createScriptUrl(runtimeGlue);
    ort.env.wasm.wasmPaths = { mjs: glue };

    try {
      const session = await ort.InferenceSession.create(model, {
        executionProviders: ['webgpu'],
        graphOptimizationLevel: 'basic',
      });
      return new Separator(ort, session);
    } finally {
      URL.revokeObjectURL(glue);
    }
  }

  /** Returns the vocals of one segment of exactly TRAINING_SAMPLES samples. */
  getVocals(left: Float32Array, right: Float32Array) {
    // The runtime forbids overlapping runs, and skipping a song can start a new
    // segment while the last song's segment is still on the GPU.
    const run = this.lastRun
      .catch(() => null)
      .then(() => this.runSegment(left, right));
    this.lastRun = run;
    return run;
  }

  private async runSegment(left: Float32Array, right: Float32Array) {
    const { waveform, magSpec } = prepareModelInput(left, right);
    const [waveformName, spectrumName] = this.session.inputNames;

    const results = await this.session.run({
      [waveformName]: new this.ort.Tensor('float32', waveform, [
        1,
        2,
        TRAINING_SAMPLES,
      ]),
      [spectrumName]: new this.ort.Tensor('float32', magSpec, [
        1,
        4,
        MODEL_SPEC_BINS,
        MODEL_SPEC_FRAMES,
      ]),
    });

    const outputs = Object.values(results);
    const timeOutput = outputs.find(
      (tensor) => tensor.dims.length === TIME_OUTPUT_RANK,
    );
    const spectrumOutput = outputs.find(
      (tensor) => tensor.dims.length > TIME_OUTPUT_RANK,
    );
    if (!timeOutput || !spectrumOutput) {
      throw new Error('Unexpected model output');
    }

    // The model has a time branch and a spectrum branch, and the result is their
    // sum. Each spectrum plane is one contiguous run of bins * frames values.
    const plane = MODEL_SPEC_BINS * MODEL_SPEC_FRAMES;
    const spectrum = spectrumOutput.data as Float32Array;
    const firstPlane = VOCALS_TRACK * 4;
    const planeAt = (index: number) => {
      const start = (firstPlane + index) * plane;
      return spectrum.subarray(start, start + plane);
    };
    const vocals = standaloneIspec(
      {
        leftReal: planeAt(0),
        leftImag: planeAt(1),
        rightReal: planeAt(2),
        rightImag: planeAt(3),
      },
      TRAINING_SAMPLES,
    );

    const time = timeOutput.data as Float32Array;
    const trackStart = VOCALS_TRACK * 2 * TRAINING_SAMPLES;
    for (let i = 0; i < TRAINING_SAMPLES; i++) {
      vocals.left[i] += time[trackStart + i];
      vocals.right[i] += time[trackStart + TRAINING_SAMPLES + i];
    }

    for (const tensor of outputs) tensor.dispose();
    return vocals;
  }

  async release() {
    await this.lastRun.catch(() => null);
    await this.session.release();
  }
}
