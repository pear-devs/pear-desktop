import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { app, net } from 'electron';

/**
 * Files for the optional AI beat tracker, downloaded once on first use and
 * kept in the app's data folder. Pinned by SHA-256, so a corrupted or
 * tampered download is never used.
 */
const ASSETS = {
  // Beat This! (CPJKU, ISMIR 2024, MIT) final0 weights exported to ONNX
  model: {
    file: 'beat-this-final0.onnx',
    url: 'https://github.com/jgorset/beat-this/releases/download/v1.0.0/beat-this.onnx',
    size: 83_008_106,
    sha256: '5d8a94ce99fb33a6b26df6f6d8076decd52b8fd9439e3206d9b8bcdb1c2881bd',
  },
  // ONNX Runtime Web 1.23.2 WebAssembly binary used by its WebGPU build
  // (the bundled runtime, see ai-worker.ts)
  wasm: {
    file: 'ort-wasm-simd-threaded.asyncify-1.23.2.wasm',
    url: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/ort-wasm-simd-threaded.asyncify.wasm',
    size: 25_499_390,
    sha256: 'babec0bbddb6d3082623b99b7e1391b75e0729bcca076ff8424d7753af97fada',
  },
} as const;

type Asset = (typeof ASSETS)[keyof typeof ASSETS];

const folder = () => join(app.getPath('userData'), 'automix-ai');

const sha256 = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');

const load = async (asset: Asset): Promise<Uint8Array> => {
  const path = join(folder(), asset.file);

  const existing = await stat(path).catch(() => null);
  if (existing?.size === asset.size) {
    const bytes = new Uint8Array(await readFile(path));
    if (sha256(bytes) === asset.sha256) return bytes;
  }

  const response = await net.fetch(asset.url);
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}): ${asset.url}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (sha256(bytes) !== asset.sha256) {
    throw new Error(`Checksum mismatch, not using ${asset.url}`);
  }

  await mkdir(folder(), { recursive: true });
  await writeFile(`${path}.part`, bytes);
  await rename(`${path}.part`, path);
  return bytes;
};

let pending: Promise<{ model: Uint8Array; wasm: Uint8Array }> | null = null;

/** Model + runtime bytes, downloading them the first time */
export const loadAiAssets = () => {
  pending ??= Promise.all([load(ASSETS.model), load(ASSETS.wasm)])
    .then(([model, wasm]) => ({ model, wasm }))
    .catch((error: unknown) => {
      pending = null;
      throw error;
    });
  return pending;
};
