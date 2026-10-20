// Internal wire protocol between the main process, the preload and the page
// runtime. Plugins never use this directly.

import type { ConfigShape } from "./config.ts";
import type { CoreSection } from "./core-config.ts";
import type { NowPlaying, PlayerAction } from "./player.ts";

/** Origin of the standalone settings window (served by the host). */
export const SETTINGS_ORIGIN = "pear://settings";

export const CHANNEL = {
  invoke: "pear:invoke",
  bootstrap: "pear:bootstrap",
  event: "pear:event",
} as const;

export interface PluginState {
  enabled: boolean;
  config: Record<string, unknown>;
}

export interface PluginMeta {
  /** Has a beforeReady hook: enabling/disabling only fully applies after a restart. */
  restartRequired: boolean;
}

/** A core settings section: its config and what the core is doing with it. */
export interface CoreState {
  config: Record<string, unknown>;
  /** e.g. the address the API server listens on. */
  status?: string;
  error?: string;
}

/** What the settings UI shows about a plugin (sent by the host, so it works without the page). */
export interface PluginInfo {
  id: string;
  name: string;
  description?: string;
  config: ConfigShape;
}

export interface AppInfo {
  version: string;
  platform: string;
  arch: string;
  electron: string;
  chrome: string;
  node: string;
}

export interface Bootstrap {
  version: string;
  platform: string;
  /** Only plugins supported on this platform. */
  plugins: Record<string, PluginState>;
  meta: Record<string, PluginMeta>;
  /** Host-side errors so far, by plugin id. */
  errors: Record<string, string>;
  core: Record<CoreSection, CoreState>;
  app: AppInfo;
  /** The active language and its strings (English underneath). */
  language: string;
  strings: Record<string, string>;
  /** Plugins supported on this platform, in settings-UI form. */
  catalog: PluginInfo[];
}

export type UiAction = "toggle-settings" | "open-settings" | "close-settings";

export type HostEvent =
  | { type: "plugin-state"; id: string; state: PluginState }
  | { type: "plugin-event"; id: string; event: string; payload: unknown }
  /** An empty message clears the plugin's host error. */
  | { type: "plugin-error"; id: string; message: string }
  | { type: "plugin-request"; id: string; event: string; payload: unknown; requestId: number }
  | { type: "core-state"; section: CoreSection; state: CoreState }
  | { type: "player-control"; action: PlayerAction }
  | { type: "ui"; action: UiAction };

/** Commands the page runtime may invoke on the host. */
export interface CoreCommands {
  ping(message: string): string;
  "app:version"(): string;
  "app:relaunch"(): void;
  "plugin:set-enabled"(id: string, enabled: boolean): void;
  "plugin:set-config"(id: string, patch: Record<string, unknown>): void;
  "plugin:invoke"(id: string, command: string, args: unknown[]): unknown;
  "plugin:respond"(requestId: number, ok: boolean, value: unknown): void;
  "core:set-config"(section: CoreSection, patch: Record<string, unknown>): void;
  /** Reveals config.json in the file manager. */
  "app:show-settings-file"(): void;
  "app:toggle-devtools"(): void;
  "player:update"(state: NowPlaying): void;
}

export type CoreCommandName = keyof CoreCommands;

/** What the preload exposes on `window.__pear` in YTM's main world. */
export interface Bridge {
  readonly bootstrap: Bootstrap;
  invoke<K extends CoreCommandName>(
    name: K,
    ...args: Parameters<CoreCommands[K]>
  ): Promise<Awaited<ReturnType<CoreCommands[K]>>>;
  onEvent(listener: (event: HostEvent) => void): void;
}
