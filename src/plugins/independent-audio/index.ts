import { app, ipcMain } from 'electron';

import { createPlugin } from '@/utils';

import { startAudioServer } from './backend';
import { attachGraph } from './graph';

import type { RendererContext } from '@/types/contexts';

const PCM = 'independent-audio:pcm';
const GAIN = 'independent-audio:gain';
let server: Awaited<ReturnType<typeof startAudioServer>> | undefined;
let graph: Awaited<ReturnType<typeof attachGraph>> | undefined;
let rendererContext: RendererContext<{ enabled: boolean }> | undefined;
let generation = 0;
let attaching = false;
let gain = 1;
let inFlight = 0;

async function audioReady(event: CustomEvent<Compressor>) {
  if (graph || attaching || !rendererContext) return;
  const current = generation;
  attaching = true;
  try {
    const result = await attachGraph(
      event.detail.audioContext,
      event.detail.audioSource,
      (frame) => {
        if (!rendererContext || inFlight >= 4) return;
        inFlight++;
        rendererContext.ipc
          .invoke(PCM, frame)
          .catch(() => {})
          .finally(() => {
            inFlight--;
          });
      },
    );
    if (current !== generation) {
      result.stop();
      return;
    }
    graph = result;
    graph.setGain(gain);
    console.log(
      '[Independent audio] Independent capture and local monitor are ready.',
    );
  } catch (error) {
    console.error('[Independent audio] Audio graph failed:', error);
  } finally {
    attaching = false;
  }
}

export default createPlugin({
  name: () => 'Independent Audio Monitoring',
  description: () =>
    'Experimental PCM capture with independent local listening gain.',
  restartNeeded: true,
  config: { enabled: false },
  backend: {
    async start({ window }) {
      server = await startAudioServer(app.getPath('userData'), (value) => {
        if (!window.isDestroyed()) window.webContents.send(GAIN, value);
      });
      ipcMain.handle(PCM, receivePCM);
      function receivePCM(
        event: Electron.IpcMainInvokeEvent,
        frame: ArrayBuffer,
      ) {
        if (event.sender === window.webContents) server?.publish(frame);
      }
      app.once('before-quit', () => {
        server?.stop().catch(console.error);
      });
    },
    async stop() {
      ipcMain.removeHandler(PCM);
      const previous = server;
      server = undefined;
      await previous?.stop();
    },
  },
  renderer: {
    start(context) {
      rendererContext = context;
      context.ipc.on(GAIN, (value: number) => {
        if (Number.isFinite(value) && value >= 0 && value <= 1) {
          gain = value;
          graph?.setGain(value);
        }
      });
      document.addEventListener('peard:audio-can-play', audioReady);
    },
    stop(context) {
      generation++;
      document.removeEventListener('peard:audio-can-play', audioReady);
      context.ipc.removeAllListeners(GAIN);
      graph?.stop();
      graph = undefined;
      rendererContext = undefined;
      gain = 1;
    },
  },
});
