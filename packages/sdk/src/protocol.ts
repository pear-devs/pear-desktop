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

export interface Bootstrap {
  version: string;
  platform: string;
  plugins: Record<string, PluginState>;
}

export type UiAction = "toggle-settings" | "open-settings" | "close-settings";

export type HostEvent =
  | { type: "plugin-state"; id: string; state: PluginState }
  | { type: "plugin-event"; id: string; event: string; payload: unknown }
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
