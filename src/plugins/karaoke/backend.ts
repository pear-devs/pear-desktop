import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { appendFile, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { app, net } from 'electron';
import wasmPath from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?asset';

import { createBackend } from '@/utils';

import {
  type PhoneLine,
  setPhoneLines,
  setPhoneState,
  startPhoneServer,
  stopPhoneServer,
} from './phone-server';

import type { KaraokePluginConfig } from './types';
import type { BackendContext } from '@/types/contexts';

const MODEL_URL =
  'https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx';
const MODEL_FILE = 'htdemucs_embedded.onnx';
const MODEL_SHA256 =
  'e5e425c17683f163a472462eb5f5a4ffcd11c31858d57fbd0833b012d8b88077';

const downloadModel = async (
  path: string,
  onProgress: (percent: number) => void,
) => {
  const response = await net.fetch(MODEL_URL);
  if (!response.ok || !response.body) {
    throw new Error(`Model download failed: ${response.status}`);
  }

  const total = Number(response.headers.get('content-length')) || 0;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total) onProgress(Math.round((received / total) * 100));
  }

  const model = Buffer.concat(chunks);
  const hash = createHash('sha256').update(model).digest('hex');
  if (hash !== MODEL_SHA256) throw new Error('Model checksum did not match');

  await writeFile(path, model);
  return model;
};

const getModel = async (onProgress: (percent: number) => void) => {
  const folder = join(app.getPath('userData'), 'karaoke');
  mkdirSync(folder, { recursive: true });

  const path = join(folder, MODEL_FILE);
  if (existsSync(path)) return await readFile(path);
  return await downloadModel(path, onProgress);
};

const LOG_FILE = 'diagnostics.log';
const MAX_LOG_BYTES = 4 * 1024 * 1024;

const startLog = async () => {
  const folder = join(app.getPath('userData'), 'karaoke');
  mkdirSync(folder, { recursive: true });

  const path = join(folder, LOG_FILE);
  if (existsSync(path) && statSync(path).size > MAX_LOG_BYTES) await rm(path);
  return path;
};

const applyPhoneRemote = (
  ctx: BackendContext<KaraokePluginConfig>,
  isOn: boolean,
) => {
  if (!isOn) {
    stopPhoneServer();
    return;
  }

  startPhoneServer((action, value) => {
    ctx.ipc.send('karaoke:phone-command', action, value);
  });
};

let context: BackendContext<KaraokePluginConfig> | null = null;

export const backend = createBackend<object, KaraokePluginConfig>({
  async start(ctx) {
    context = ctx;
    ctx.ipc.on('karaoke:phone-state', setPhoneState);
    ctx.ipc.on('karaoke:phone-lines', (lines: PhoneLine[]) => {
      setPhoneLines(lines);
    });
    applyPhoneRemote(ctx, (await ctx.getConfig()).phoneRemote);

    const logPath = await startLog();
    ctx.ipc.on('karaoke:log', (line: string) => {
      appendFile(logPath, `${line}\n`).catch(() => null);
    });

    ctx.ipc.handle('karaoke:get-runtime', async () => ({
      wasm: await readFile(wasmPath),
      model: await getModel((percent) => {
        ctx.ipc.send('karaoke:model-progress', percent);
      }),
    }));
  },

  onConfigChange(config) {
    if (context) applyPhoneRemote(context, config.phoneRemote);
  },

  stop(ctx) {
    stopPhoneServer();
    ctx.ipc.removeHandler('karaoke:get-runtime');
  },
});
