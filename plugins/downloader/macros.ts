// Build-time macros (`with { type: "macro" }`): run while bundling.

import { createRequire } from "node:module";
import { dirname } from "node:path";

/** Where ffmpeg.wasm's core is in a development checkout; packaged apps have it in their resources (electron-builder.yml). */
export function ffmpegCoreDir(): string {
  return dirname(createRequire(import.meta.url).resolve("@ffmpeg.wasm/core-mt"));
}
