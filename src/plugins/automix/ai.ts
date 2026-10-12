// Vite turns this into a Worker constructor
// oxlint-disable-next-line import/default
import AiWorker from './ai-worker?worker&inline';

import type { AiRequest, AiResponse } from './ai-worker';

export interface AiBeats {
  beats: number[];
  downbeats: number[];
}

/**
 * Optional AI beat / downbeat tracker. Runs in a Web Worker so the UI never
 * stutters; one song section at a time.
 */
export class AiBeatTracker {
  private readonly worker: Worker;
  private readonly ready: Promise<string>;
  private readonly waiting = new Map<
    number,
    { resolve: (beats: AiBeats) => void; reject: (error: Error) => void }
  >();
  private nextId = 0;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(assets: { model: Uint8Array; wasm: Uint8Array }) {
    this.worker = new AiWorker();
    this.ready = new Promise((resolve, reject) => {
      this.worker.addEventListener(
        'message',
        (event: MessageEvent<AiResponse>) => {
          const message = event.data;
          if (message.type === 'ready') {
            resolve(message.provider);
            return;
          }
          if (message.id === undefined) {
            reject(new Error(message.type === 'error' ? message.message : ''));
            return;
          }
          const waiter = this.waiting.get(message.id);
          this.waiting.delete(message.id);
          if (message.type === 'result') waiter?.resolve(message);
          else waiter?.reject(new Error(message.message));
        },
      );
      this.worker.addEventListener('error', (event) =>
        reject(new Error(event.message)),
      );
    });
    // Hand the ~100 MB over instead of copying it
    this.post({ type: 'init', model: assets.model, wasm: assets.wasm }, [
      assets.model.buffer,
      assets.wasm.buffer,
    ]);
  }

  /** Which backend the model runs on ("webgpu" or "wasm") */
  get provider() {
    return this.ready;
  }

  /** Beats / downbeats (seconds) of mono 22,050 Hz audio */
  analyze(audio: Float32Array): Promise<AiBeats> {
    const run = async () => {
      await this.ready;
      const id = this.nextId++;
      return new Promise<AiBeats>((resolve, reject) => {
        this.waiting.set(id, { resolve, reject });
        this.post({ type: 'analyze', id, audio }, [audio.buffer]);
      });
    };
    const result = this.chain.then(run, run);
    this.chain = result.catch(() => null);
    return result;
  }

  dispose() {
    this.worker.terminate();
    for (const waiter of this.waiting.values()) {
      waiter.reject(new Error('Stopped'));
    }
    this.waiting.clear();
  }

  private post(message: AiRequest, transfer: Transferable[] = []) {
    this.worker.postMessage(message, transfer);
  }
}
