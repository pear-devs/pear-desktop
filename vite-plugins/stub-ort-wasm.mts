import type { Plugin } from 'vite';

/**
 * ONNX Runtime Web points at its WebAssembly binary with
 * `new URL('ort-wasm-….wasm', import.meta.url)`, which Vite would inline
 * (~25 MB, then base64 again inside an inline worker) into the AutoMix AI
 * worker. AutoMix always hands the runtime its binary itself (downloaded on
 * demand, see src/plugins/automix/ai-assets.ts), so blank the reference.
 */
export default function stubOrtWasm(): Plugin {
  return {
    name: 'stub-ort-wasm',
    enforce: 'pre',
    transform(code, id) {
      if (!/onnxruntime-web[\\/]dist[\\/].+\.mjs$/.test(id)) return null;
      return code.replaceAll(
        /new URL\((["'])ort-wasm-simd-threaded[\w.]*\.wasm\1, ?import\.meta\.url\)/g,
        'new URL("about:blank")',
      );
    },
  };
}
