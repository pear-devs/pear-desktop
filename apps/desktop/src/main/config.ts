// Persistent settings: pear-desktop's config.json in userData, in its layout,
// so existing installs keep their settings:
//
//   plugins.<id>        { enabled, ...config }      (the API server: plugins.api-server)
//   options.*           the core sections (general, window, appearance, advanced, site)
//   url, window-size, window-position, window-maximized
//   __internal__.migrations.version                 like electron-store
//
// Values are normalized against their schema on load, so stale or hand-edited
// ones fall back to defaults instead of crashing anything. Keys this version
// doesn't know are kept, for older versions and future migrations.

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type AnyPlugin, type ConfigOf, type ConfigShape, isEnabledByDefault, normalizeConfig } from "@pear/sdk";
import { CORE_SECTIONS, type CoreSection } from "@pear/sdk/core-config";
import type { PluginState } from "@pear/sdk/protocol";
import { isRecord, type MigratedFiles, type StoredConfig } from "./migrations/helpers.ts";
import { migrate } from "./migrations/index.ts";

export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

type CoreConfigs = { [K in CoreSection]: ConfigOf<(typeof CORE_SECTIONS)[K]> };
type Json = Record<string, unknown>;

export const CONFIG_FILE = "config.json";
/** The API server is a core section, stored where pear-desktop's plugin kept it. */
const API_SERVER_PLUGIN = "api-server";
const WRITE_DELAY_MS = 300;

export class Settings {
  readonly path: string;
  #data: StoredConfig;
  #plugins = new Map<string, PluginState>();
  #core: CoreConfigs;
  #writeTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(userData: string, plugins: readonly AnyPlugin[], appVersion: string, platform: string = process.platform) {
    this.path = join(userData, CONFIG_FILE);
    const { config, migrated, files } = migrate(readJson(this.path), appVersion);
    this.#data = config;
    writeMissingFiles(userData, files);
    this.#core = Object.fromEntries(
      Object.entries(CORE_SECTIONS).map(([name, shape]) => [name, normalizeConfig(shape, this.#coreSource(name as CoreSection))]),
    ) as CoreConfigs;
    for (const plugin of plugins) {
      const entry = this.#data.plugins?.[plugin.id];
      this.#plugins.set(plugin.id, {
        enabled: typeof entry?.enabled === "boolean" ? entry.enabled : isEnabledByDefault(plugin, platform),
        config: plugin.config ? normalizeConfig(plugin.config, entry) : {},
      });
    }
    // Persist a migration right away, so it never runs twice.
    if (migrated) this.#write();
  }

  plugin(id: string): PluginState | undefined {
    return this.#plugins.get(id);
  }

  allPlugins(): Record<string, PluginState> {
    return Object.fromEntries(this.#plugins);
  }

  setPlugin(plugin: AnyPlugin, patch: { enabled?: boolean; config?: Record<string, unknown> }): PluginState {
    const current = this.#plugins.get(plugin.id) ?? { enabled: false, config: {} };
    const next: PluginState = {
      enabled: patch.enabled ?? current.enabled,
      config: plugin.config ? normalizeConfig(plugin.config, { ...current.config, ...patch.config }) : {},
    };
    this.#plugins.set(plugin.id, next);
    this.#putPlugin(plugin.id, { enabled: next.enabled, ...next.config });
    return next;
  }

  core<K extends CoreSection>(section: K): CoreConfigs[K] {
    return this.#core[section];
  }

  allCore(): CoreConfigs {
    return this.#core;
  }

  setCore<K extends CoreSection>(section: K, patch: Partial<CoreConfigs[K]>): CoreConfigs[K] {
    const shape: ConfigShape = CORE_SECTIONS[section];
    const next = normalizeConfig(shape, { ...this.#core[section], ...patch }) as CoreConfigs[K];
    this.#core[section] = next;
    if (section === "apiServer") this.#putPlugin(API_SERVER_PLUGIN, next);
    else {
      this.#data.options = { ...this.#data.options, ...next };
      this.#scheduleWrite();
    }
    return next;
  }

  get window(): WindowState | undefined {
    const size = this.#data["window-size"];
    if (!isRecord(size) || typeof size.width !== "number" || typeof size.height !== "number") return undefined;
    const position = placedPosition(this.#data["window-position"]);
    return {
      width: size.width,
      height: size.height,
      ...position,
      maximized: this.#data["window-maximized"] === true,
    };
  }

  set window(state: WindowState) {
    this.#data["window-size"] = { width: state.width, height: state.height };
    if (state.x !== undefined && state.y !== undefined) this.#data["window-position"] = { x: state.x, y: state.y };
    this.#data["window-maximized"] = state.maximized;
    this.#scheduleWrite();
  }

  get lastUrl(): string | undefined {
    return typeof this.#data.url === "string" ? this.#data.url : undefined;
  }

  set lastUrl(url: string) {
    if (this.#data.url === url) return;
    this.#data.url = url;
    this.#scheduleWrite();
  }

  /** Writes pending changes immediately (on quit). */
  flush() {
    if (this.#writeTimer === undefined) return;
    clearTimeout(this.#writeTimer);
    this.#write();
  }

  #coreSource(section: CoreSection): unknown {
    return section === "apiServer" ? this.#data.plugins?.[API_SERVER_PLUGIN] : this.#data.options;
  }

  #putPlugin(id: string, values: Json) {
    // Keep keys this version doesn't know (an older version's, say).
    this.#data.plugins = { ...this.#data.plugins, [id]: { ...this.#data.plugins?.[id], ...values } };
    this.#scheduleWrite();
  }

  #scheduleWrite() {
    clearTimeout(this.#writeTimer);
    this.#writeTimer = setTimeout(() => this.#write(), WRITE_DELAY_MS);
  }

  #write() {
    this.#writeTimer = undefined;
    mkdirSync(dirname(this.path), { recursive: true });
    const temp = `${this.path}.tmp`;
    // Tabs, like electron-store writes it.
    writeFileSync(temp, `${JSON.stringify(this.#data, null, "\t")}\n`);
    renameSync(temp, this.path);
  }
}

/** Files a migration created next to config.json, unless they exist already. */
function writeMissingFiles(userData: string, files: MigratedFiles) {
  for (const [name, contents] of Object.entries(files)) {
    const path = join(userData, name);
    if (!existsSync(path)) writeFileSync(path, JSON.stringify(contents));
  }
}

/** The saved window position, unless the OS is to place the window. */
function placedPosition(position: unknown): { x: number; y: number } | undefined {
  if (!isRecord(position)) return undefined;
  const { x, y } = position;
  if (typeof x !== "number" || typeof y !== "number") return undefined;
  // pear-desktop writes -1/-1 for "let the OS place it".
  if (x === -1 && y === -1) return undefined;
  return { x, y };
}

function readJson(path: string): StoredConfig | undefined {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    // Not there yet: a fresh profile.
    return undefined;
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (isRecord(parsed)) return parsed as StoredConfig;
  } catch {
    // Damaged; kept below.
  }
  keepDamaged(path);
  return undefined;
}

/** A config.json that can't be read is about to be replaced by defaults; keep it next to it, to recover settings by hand. */
function keepDamaged(path: string) {
  const backup = `${path}.damaged-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  try {
    copyFileSync(path, backup);
    console.warn(`[pear] ${path} couldn't be read; starting from defaults, the old file is at ${backup}`);
  } catch (error) {
    console.error(`[pear] ${path} couldn't be read, nor kept`, error);
  }
}
