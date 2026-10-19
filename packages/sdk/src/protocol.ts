// Internal wire protocol between the main process, the preload and the page
// runtime. Plugins never use this directly.

import type { NowPlaying, PlayerAction } from "./player.ts";

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

export interface Bootstrap {
  version: string;
  platform: string;
  /** Only plugins supported on this platform. */
  plugins: Record<string, PluginState>;
  meta: Record<string, PluginMeta>;
  /** Host-side errors so far, by plugin id. */
  errors: Record<string, string>;
}

export type UiAction = "toggle-settings" | "open-settings" | "close-settings";

export type HostEvent =
  | { type: "plugin-state"; id: string; state: PluginState }
  | { type: "plugin-event"; id: string; event: string; payload: unknown }
  /** An empty message clears the plugin's host error. */
  | { type: "plugin-error"; id: string; message: string }
  | { type: "plugin-request"; id: string; event: string; payload: unknown; requestId: number }
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
