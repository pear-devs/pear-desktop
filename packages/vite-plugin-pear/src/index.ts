// The pear "macro compiler" as a Vite plugin.
//
// - Discovers plugins (`plugins/<id>/index.ts`, or `index.tsx`).
// - `virtual:pear/host-plugins` (main process): every plugin, split for the host.
// - `virtual:pear/page-runtime` (preload): the page runtime plus every plugin
//   split for the page, bundled by Rolldown into one self-contained IIFE string
//   that the preload runs in YTM's main world.
// - `virtual:pear/settings-app` (main process): the standalone settings window's
//   script (the settings UI over the bridge), bundled the same way.
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
const SETTINGS_APP_ID = "virtual:pear/settings-app";
const VIRTUAL_IDS = new Set([HOST_PLUGINS_ID, PAGE_RUNTIME_ID, SETTINGS_APP_ID]);
// The id keeps ending in the file's extension (`&lang.ts`, `&lang.tsx`): the macro
// analyzer picks its parser from it and would parse TypeScript as JavaScript otherwise.
const SPLIT_SUFFIX = String.raw`\?pear=(host|page)&lang\.tsx?`;
const SPLIT_QUERY = new RegExp(`${SPLIT_SUFFIX}$`);
// unplugin-macros' default filter rejects ids with a query (our split ids).
const MACRO_OPTIONS = { include: [new RegExp(String.raw`\.[cm]?[jt]sx?(${SPLIT_SUFFIX})?$`)] };
const ENTRY_NAMES = ["index.ts", "index.tsx"];

export interface PearPluginOptions {
  /** Directory containing one folder per plugin. */
  pluginsDir: string;
  /** Entry of the page runtime. Defaults to @pear/page. */
  pageEntry?: string;
  /** Entry of the standalone settings window. Defaults to @pear/ui/standalone. */
  settingsEntry?: string;
  /** Only include these plugin ids (tests). */
  only?: readonly string[];
}

export function discoverPlugins({ pluginsDir, only }: PearPluginOptions): string[] {
  if (!existsSync(pluginsDir)) return [];
  return readdirSync(pluginsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && (!only || only.includes(entry.name)))
    .map((entry) => ENTRY_NAMES.map((name) => resolve(pluginsDir, entry.name, name)).find((file) => existsSync(file)))
    .filter((file) => file !== undefined)
    .sort();
}

const extensionOf = (file: string) => (file.endsWith(".tsx") ? "tsx" : "ts");

function registryModule(files: readonly string[], target: SplitTarget) {
  const splitId = (file: string) => `${file}?pear=${target}&lang.${extensionOf(file)}`;
  const imports = files.map((file, i) => `import p${i} from ${JSON.stringify(splitId(file))};`);
  return `${imports.join("\n")}\nexport default [${files.map((_, i) => `p${i}`).join(", ")}];\n`;
}

function splitTransform(code: string, id: string) {
  const match = SPLIT_QUERY.exec(id);
  if (!match) return;
  const file = id.replace(SPLIT_QUERY, "");
  return { code: splitPlugin(code, file, match[1] as SplitTarget), map: null };
}

export default function pear(options: PearPluginOptions): Plugin[] {
  // The virtual modules that are a bundle of their own, and its entry.
  const bundleEntries: Record<string, string> = {
    [`\0${PAGE_RUNTIME_ID}`]: options.pageEntry ?? fileURLToPath(import.meta.resolve("@pear/page")),
    [`\0${SETTINGS_APP_ID}`]: options.settingsEntry ?? fileURLToPath(import.meta.resolve("@pear/ui/standalone")),
  };

  const plugin: Plugin = {
    name: "pear",
    enforce: "pre",
    resolveId(id) {
      if (VIRTUAL_IDS.has(id)) return `\0${id}`;
    },
    load(id) {
      if (id === `\0${HOST_PLUGINS_ID}`) {
        const files = discoverPlugins(options);
        this.addWatchFile(options.pluginsDir);
        return registryModule(files, "host");
      }
      const entry = bundleEntries[id];
      if (entry) {
        return bundlePage(entry, options).then(({ code, watchFiles }) => {
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
        const file = id.replace(SPLIT_QUERY, "");
        return { code: readFileSync(file, "utf8"), moduleType: extensionOf(file) };
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
    // JSX: tsconfig.base.json's Preact, or the DOM runtime in files whose pragma asks for @pear/sdk.
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
