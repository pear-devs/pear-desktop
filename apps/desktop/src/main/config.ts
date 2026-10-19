// Persistent settings: pear-desktop's config.json in userData, in its layout,
// so existing installs keep their settings:
//
//   plugins.<id>        { enabled, ...config }
//   url, window-size, window-position, window-maximized
//
// Values are normalized against their schema on load, so stale or hand-edited
// ones fall back to defaults instead of crashing anything. Keys this version
// doesn't know are kept, for older versions and future migrations.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type AnyPlugin, normalizeConfig } from "@pear/sdk";
import type { PluginState } from "@pear/sdk/protocol";

export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

type Json = Record<string, unknown>;

interface StoredConfig {
  plugins?: Record<string, Json>;
  options?: Json;
  url?: unknown;
  "window-size"?: unknown;
  "window-position"?: unknown;
  "window-maximized"?: unknown;
  [key: string]: unknown;
}

export const CONFIG_FILE = "config.json";
const WRITE_DELAY_MS = 300;

const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

export class Settings {
  readonly path: string;
  #data: StoredConfig;
  #plugins = new Map<string, PluginState>();
  #writeTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(userData: string, plugins: readonly AnyPlugin[]) {
    this.path = join(userData, CONFIG_FILE);
    this.#data = readJson(this.path) ?? {};
    for (const plugin of plugins) {
      const entry = this.#data.plugins?.[plugin.id];
      this.#plugins.set(plugin.id, {
        enabled: typeof entry?.enabled === "boolean" ? entry.enabled : (plugin.enabledByDefault ?? false),
        config: plugin.config ? normalizeConfig(plugin.config, entry) : {},
      });
    }
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

  get window(): WindowState | undefined {
    const size = this.#data["window-size"];
    if (!isRecord(size) || typeof size.width !== "number" || typeof size.height !== "number") return undefined;
    const position = this.#data["window-position"];
    // pear-desktop writes -1/-1 for "let the OS place it".
    const placed =
      isRecord(position) &&
      typeof position.x === "number" &&
      typeof position.y === "number" &&
      !(position.x === -1 && position.y === -1);
    return {
      width: size.width,
      height: size.height,
      ...(placed ? { x: position.x as number, y: position.y as number } : {}),
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

function readJson(path: string): StoredConfig | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return isRecord(parsed) ? (parsed as StoredConfig) : undefined;
  } catch {
    return undefined;
  }
}
