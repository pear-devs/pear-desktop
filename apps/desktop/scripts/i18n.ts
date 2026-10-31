// Keeps src/i18n/resources/en.json (the source Weblate translates from) in step
// with the English texts in the code:
//
//   - settings fields of every plugin and of the core (labels, descriptions,
//     placeholders, options, group headings),
//   - plugin names and descriptions not translated yet,
//   - the settings dialog's own texts (packages/ui/src/strings.ts),
//   - literal `t("key", "English")` calls in the sources.
//
// Existing keys are never changed (their English is Weblate's source text);
// new ones are appended. `--check` only reports missing keys (CI).
//
//   nub run i18n            add missing keys to en.json
//   nub run i18n --check    exit 1 if any are missing

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pear from "@pear/vite-plugin";
import { type AnyPlugin, type ConfigShape, pluginActions } from "@pear/sdk";
import { createServer } from "vite";
import { escapeNames } from "../../../scripts/escape-names.ts";

const desktop = resolve(import.meta.dirname, "..");
const repo = resolve(desktop, "../..");
const EN = join(repo, "src/i18n/resources/en.json");

const ELECTRON_STUB = pathToFileURL(join(import.meta.dirname, "electron-stub.js")).href;

await main();

async function main() {
  installElectronStub();
  const wanted = wantedStrings(await loadModules());
  const en = JSON.parse(readFileSync(EN, "utf8")) as Record<string, unknown>;
  const missing = [...wanted].filter(([key]) => lookup(en, key) === undefined);
  if (process.argv.includes("--check")) {
    for (const [key] of missing) console.error(`i18n: en.json is missing "${key}"`);
    if (missing.length > 0) {
      console.error(`i18n: ${missing.length} missing; run \`nub run i18n\``);
      process.exit(1);
    }
    console.log("i18n: en.json is up to date");
    return;
  }
  for (const [key, english] of missing) insert(en, key, english);
  // JSON.stringify writes the app name plainly; keep it escaped like the rest of the repo.
  writeFileSync(EN, escapeNames(`${JSON.stringify(en, null, 2)}\n`));
  console.log(`i18n: added ${missing.length} key(s) to en.json`);
}

/**
 * Host plugins import electron, which only exists inside Electron. Packages in
 * node_modules (e.g. do-not-track's) are loaded by Node directly, not by Vite,
 * so the stub is installed as a Node resolve hook.
 */
function installElectronStub() {
  const stub = { url: ELECTRON_STUB, format: "module", shortCircuit: true } as const;
  registerHooks({
    resolve(specifier, context, next) {
      if (specifier === "electron") return stub;
      const resolved = next(specifier, context);
      // Vite imports externals by their resolved path.
      return /\/node_modules\/electron\/index\.js$/.test(resolved.url) ? stub : resolved;
    },
  });
}

type Modules = Awaited<ReturnType<typeof loadModules>>;

async function loadModules() {
  const server = await createServer({
    root: desktop,
    configFile: false,
    logLevel: "error",
    plugins: pear({ pluginsDir: join(repo, "plugins") }),
    server: { middlewareMode: true, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const plugins = (await server.ssrLoadModule("virtual:pear/host-plugins")).default as AnyPlugin[];
    const { CORE_SECTIONS } = (await server.ssrLoadModule("@pear/sdk/core-config")) as { CORE_SECTIONS: Record<string, ConfigShape> };
    const { UI_STRINGS } = (await server.ssrLoadModule(join(repo, "packages/ui/src/strings.ts"))) as { UI_STRINGS: Record<string, string> };
    const i18n = (await server.ssrLoadModule("@pear/sdk/i18n")) as typeof import("@pear/sdk/i18n");
    return { plugins, CORE_SECTIONS, UI_STRINGS, i18n };
  } finally {
    await server.close();
  }
}

/** Every key the code has an English text for, with that text. */
function wantedStrings({ plugins, CORE_SECTIONS, UI_STRINGS, i18n }: Modules) {
  const wanted = new Map<string, string>();
  for (const plugin of plugins) {
    wanted.set(`plugins.${plugin.id}.name`, plugin.name);
    if (plugin.description) wanted.set(`plugins.${plugin.id}.description`, plugin.description);
    fieldStrings(plugin.id, plugin.config ?? {}, i18n, wanted);
    for (const [name, action] of pluginActions(plugin)) {
      wanted.set(`plugins.${plugin.id}.actions.${name}.label`, action.label);
      if (action.description) wanted.set(`plugins.${plugin.id}.actions.${name}.description`, action.description);
    }
  }
  for (const shape of Object.values(CORE_SECTIONS)) fieldStrings("core", shape, i18n, wanted);
  for (const [key, english] of Object.entries(UI_STRINGS)) wanted.set(key, english);
  sourceStrings(wanted);
  return wanted;
}

function fieldStrings(owner: string, shape: ConfigShape, i18n: typeof import("@pear/sdk/i18n"), out: Map<string, string>) {
  for (const [name, field] of Object.entries(shape)) {
    const key = i18n.fieldKey(owner, name);
    out.set(`${key}.label`, field.label);
    if (field.description) out.set(`${key}.description`, field.description);
    if ("placeholder" in field && field.placeholder) out.set(`${key}.placeholder`, field.placeholder);
    if (field.group) out.set(i18n.groupKey(field.group), field.group);
    // Language names are written in their own language; nothing to translate.
    if ("options" in field && !(owner === "core" && name === "language")) {
      for (const option of field.options) out.set(`${key}.options.${option.value}`, option.label);
    }
  }
}

/** Literal `t("key", "English"…)` calls (plugins use `ctx.t`). */
function sourceStrings(out: Map<string, string>) {
  const call = /\bt\(\s*"([\w.-]+)"\s*,\s*"((?:[^"\\]|\\.)*)"/g;
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === "out" || entry.startsWith(".")) continue;
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.ts$/.test(entry)) {
        for (const [, key, english] of readFileSync(path, "utf8").matchAll(call)) out.set(key!, JSON.parse(`"${english}"`));
      }
    }
  };
  for (const dir of ["plugins", "apps/desktop/src", "packages"]) walk(join(repo, dir));
}

function lookup(tree: Record<string, unknown>, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => (typeof node === "object" && node !== null ? (node as Record<string, unknown>)[part] : undefined), tree);
}

function insert(tree: Record<string, unknown>, key: string, value: string) {
  const parts = key.split(".");
  let node = tree;
  for (const part of parts.slice(0, -1)) {
    const next = node[part];
    if (typeof next === "string") throw new Error(`en.json: "${key}" would replace the string at "${part}"`);
    node = (node[part] ??= {}) as Record<string, unknown>;
  }
  node[parts.at(-1)!] = value;
}
