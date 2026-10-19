// The pear "macro compiler". For now it only provides the page runtime as a
// string, bundled to a self-contained IIFE so the preload can run it in the
// page's main world. Plugin discovery and host/page splitting come next.

import { fileURLToPath } from "node:url";
import { build } from "rolldown";
import type { Plugin } from "vite";

const PAGE_RUNTIME_ID = "virtual:pear/page-runtime";
const RESOLVED_PAGE_RUNTIME_ID = `\0${PAGE_RUNTIME_ID}`;

export interface PearPluginOptions {
  /** Entry of the page runtime. Defaults to @pear/page. */
  pageEntry?: string;
}

export default function pear(options: PearPluginOptions = {}): Plugin {
  const pageEntry =
    options.pageEntry ?? fileURLToPath(import.meta.resolve("@pear/page"));

  return {
    name: "pear",
    resolveId(id) {
      if (id === PAGE_RUNTIME_ID) return RESOLVED_PAGE_RUNTIME_ID;
    },
    async load(id) {
      if (id !== RESOLVED_PAGE_RUNTIME_ID) return;
      const { code, watchFiles } = await bundlePage(pageEntry);
      for (const file of watchFiles) this.addWatchFile(file);
      return `export default ${JSON.stringify(code)};`;
    },
  };
}

async function bundlePage(entry: string) {
  const result = await build({
    input: entry,
    write: false,
    platform: "browser",
    output: { format: "iife", minify: process.env.NODE_ENV === "production" },
  });
  const chunk = result.output.find((o) => o.type === "chunk" && o.isEntry);
  if (!chunk || chunk.type !== "chunk") {
    throw new Error(`[pear] page runtime bundle produced no entry chunk (${entry})`);
  }
  return { code: chunk.code, watchFiles: Object.keys(chunk.modules) };
}
