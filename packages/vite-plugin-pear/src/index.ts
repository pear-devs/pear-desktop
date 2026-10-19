// The pear "macro compiler" as a Vite plugin.
//
// - Discovers plugins (`plugins/<id>/index.ts`).
// - `virtual:pear/host-plugins` (main process): every plugin, split for the host.
// - `virtual:pear/page-runtime` (preload): the page runtime plus every plugin
//   split for the page, bundled by Rolldown into one self-contained IIFE string
//   that the preload runs in YTM's main world.
// - Build-time macros (`with { type: "macro" }`) run in both bundles.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin as RolldownPlugin } from "rolldown";
import Macros from "unplugin-macros/vite";
import RolldownMacros from "unplugin-macros/rolldown";
import type { Plugin } from "vite";
import { splitPlugin, type SplitTarget } from "./split.ts";

export { splitPlugin, type SplitTarget } from "./split.ts";

const HOST_PLUGINS_ID = "virtual:pear/host-plugins";
const PAGE_PLUGINS_ID = "virtual:pear/page-plugins";
const PAGE_RUNTIME_ID = "virtual:pear/page-runtime";
// The id keeps ending in ".ts" (`&lang.ts`): the macro analyzer picks its
// parser from the extension and would parse TypeScript as JavaScript otherwise.
const SPLIT_QUERY = /\?pear=(host|page)&lang\.ts$/;
// unplugin-macros' default filter rejects ids with a query (our split ids).
const MACRO_OPTIONS = { include: [/\.[cm]?[jt]sx?(\?pear=(host|page)&lang\.ts)?$/] };

export interface PearPluginOptions {
  /** Directory containing one folder per plugin. */
  pluginsDir: string;
  /** Entry of the page runtime. Defaults to @pear/page. */
  pageEntry?: string;
  /** Only include these plugin ids (tests). */
  only?: readonly string[];
}

export function discoverPlugins({ pluginsDir, only }: PearPluginOptions): string[] {
  if (!existsSync(pluginsDir)) return [];
  return readdirSync(pluginsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(pluginsDir, entry.name, "index.ts")))
    .filter((entry) => !only || only.includes(entry.name))
    .map((entry) => resolve(pluginsDir, entry.name, "index.ts"))
    .sort();
}

function registryModule(files: readonly string[], target: SplitTarget) {
  const imports = files.map((file, i) => `import p${i} from ${JSON.stringify(`${file}?pear=${target}&lang.ts`)};`);
  return `${imports.join("\n")}\nexport default [${files.map((_, i) => `p${i}`).join(", ")}];\n`;
}

function splitTransform(code: string, id: string) {
  const match = SPLIT_QUERY.exec(id);
  if (!match) return;
  const file = id.replace(SPLIT_QUERY, "");
  return { code: splitPlugin(code, file, match[1] as SplitTarget), map: null };
}

export default function pear(options: PearPluginOptions): Plugin[] {
  const pageEntry = options.pageEntry ?? fileURLToPath(import.meta.resolve("@pear/page"));

  const plugin: Plugin = {
    name: "pear",
    enforce: "pre",
    resolveId(id) {
      if (id === HOST_PLUGINS_ID || id === PAGE_RUNTIME_ID) return `\0${id}`;
    },
    load(id) {
      if (id === `\0${HOST_PLUGINS_ID}`) {
        const files = discoverPlugins(options);
        this.addWatchFile(options.pluginsDir);
        return registryModule(files, "host");
      }
      if (id === `\0${PAGE_RUNTIME_ID}`) {
        return bundlePage(pageEntry, options).then(({ code, watchFiles }) => {
          for (const file of watchFiles) this.addWatchFile(file);
          return `export default ${JSON.stringify(code)};`;
        });
      }
    },
    transform(code, id) {
      return splitTransform(code, id);
    },
  };

  return [plugin, Macros(MACRO_OPTIONS) as Plugin];
}

function pagePluginsPlugin(options: PearPluginOptions): RolldownPlugin {
  return {
    name: "pear:page-plugins",
    resolveId(id) {
      if (id === PAGE_PLUGINS_ID) return `\0${id}`;
    },
    load(id) {
      if (id === `\0${PAGE_PLUGINS_ID}`) return registryModule(discoverPlugins(options), "page");
      if (SPLIT_QUERY.test(id)) {
        return { code: readFileSync(id.replace(SPLIT_QUERY, ""), "utf8"), moduleType: "ts" };
      }
    },
    transform(code, id) {
      return splitTransform(code, id);
    },
  };
}

/** Bundles the page runtime with every plugin's page part (exported for tests). */
export async function bundlePage(entry: string, options: PearPluginOptions) {
  const result = await build({
    input: entry,
    write: false,
    platform: "browser",
    plugins: [pagePluginsPlugin(options), RolldownMacros(MACRO_OPTIONS)],
    transform: { jsx: { runtime: "automatic", importSource: "preact" } },
    output: { format: "iife", minify: process.env.NODE_ENV === "production" },
  });
  const chunk = result.output.find((o) => o.type === "chunk" && o.isEntry);
  if (!chunk || chunk.type !== "chunk") {
    throw new Error(`[pear] page runtime bundle produced no entry chunk (${entry})`);
  }
  const watchFiles = Object.keys(chunk.modules)
    .filter((id) => !id.startsWith("\0"))
    .map((id) => id.replace(SPLIT_QUERY, ""));
  return { code: chunk.code, watchFiles: [...watchFiles, options.pluginsDir] };
}
