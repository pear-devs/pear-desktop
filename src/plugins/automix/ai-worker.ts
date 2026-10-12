/**
 * Web Worker running the optional AI beat tracker, Beat This! (CPJKU,
 * ISMIR 2024), on ONNX Runtime Web: WebGPU when available, else the CPU.
 */
import { extractFeatures, HOP_SIZE, inferBeatThis } from '@jgorset/beat-this';
import * as ort from 'onnxruntime-web/webgpu';

export type AiRequest =
  | { type: 'init'; model: Uint8Array; wasm: Uint8Array }
  | { type: 'analyze'; id: number; audio: Float32Array };

export type AiResponse =
  | { type: 'ready'; provider: string }
  | { type: 'result'; id: number; beats: number[]; downbeats: number[] }
  | { type: 'error'; id?: number; message: string };

const SAMPLE_RATE = 22050;

let session: ort.InferenceSession | null = null;

const reply = (message: AiResponse) => postMessage(message);

const createSession = async (model: Uint8Array) => {
  const providers = 'gpu' in navigator ? ['webgpu', 'wasm'] : ['wasm'];
  let lastError: unknown;
  for (const provider of providers) {
    try {
      const created = await ort.InferenceSession.create(model, {
        executionProviders: [provider],
        graphOptimizationLevel: 'all',
      });
      return { session: created, provider };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
};

const analyze = async (audio: Float32Array) => {
  if (!session) throw new Error('The beat tracker is not ready');
  const frames = Math.floor(audio.length / HOP_SIZE) + 1;
  const result = await inferBeatThis(session, frames, (first, count) => {
    const begin = Math.max(0, (first * HOP_SIZE) - 1024);
    const end = Math.min(audio.length, ((first + count) * HOP_SIZE) + 1024);
    return Promise.resolve(
      extractFeatures(audio.subarray(begin, end), first, count, audio.length, begin),
    );
  });
  const duration = audio.length / SAMPLE_RATE;
  return {
    beats: result.beats.filter((time) => time < duration),
    downbeats: result.downbeats.filter((time) => time < duration),
  };
};

self.addEventListener('message', (event: MessageEvent<AiRequest>) => {
  const request = event.data;
  const run = async () => {
    if (request.type === 'init') {
      ort.env.wasm.wasmBinary = request.wasm;
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      const created = await createSession(request.model);
      session = created.session;
      reply({ type: 'ready', provider: created.provider });
    } else {
      reply({ type: 'result', id: request.id, ...(await analyze(request.audio)) });
    }
  };
  run().catch((error: unknown) => {
    reply({
      type: 'error',
      id: request.type === 'analyze' ? request.id : undefined,
      message: error instanceof Error ? error.message : String(error),
    });
  });
});
