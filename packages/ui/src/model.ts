// What the settings UI reads and changes. The page runtime implements it in
// YTM; `bridgeModel` implements it over the bare bridge for the
// standalone settings window.

import type { CoreSection } from "@pear/sdk/core-config";
import { type Translate, translator } from "@pear/sdk/i18n";
import type { AppInfo, Bridge, CoreState, PluginInfo, PluginMeta, PluginState } from "@pear/sdk/protocol";

export interface SettingsModel {
  readonly app: AppInfo;
  readonly plugins: readonly PluginInfo[];
  /** The active language's strings. */
  readonly t: Translate;
  state(id: string): PluginState | undefined;
  error(id: string): string | undefined;
  meta(id: string): PluginMeta | undefined;
  core(section: CoreSection): CoreState | undefined;
  subscribe(listener: () => void): () => void;
  setEnabled(id: string, enabled: boolean): Promise<unknown>;
  setConfig(id: string, patch: Record<string, unknown>): Promise<unknown>;
  setCoreConfig(section: CoreSection, patch: Record<string, unknown>): Promise<unknown>;
  relaunch(): Promise<unknown>;
  showSettingsFile(): Promise<unknown>;
  toggleDevTools(): Promise<unknown>;
}

/** A model over the bridge alone, for the standalone window (no page runtime). */
export function bridgeModel(bridge: Bridge): SettingsModel {
  const { bootstrap } = bridge;
  const states = new Map(Object.entries(bootstrap.plugins));
  const errors = new Map(Object.entries(bootstrap.errors));
  const core = { ...bootstrap.core };
  const subscribers = new Set<() => void>();
  const notify = () => subscribers.forEach((listener) => listener());

  bridge.onEvent((event) => {
    if (event.type === "plugin-state") states.set(event.id, event.state);
    else if (event.type === "plugin-error") {
      if (event.message) errors.set(event.id, event.message);
      else errors.delete(event.id);
    } else if (event.type === "core-state") core[event.section] = event.state;
    else return;
    notify();
  });

  return {
    app: bootstrap.app,
    plugins: bootstrap.catalog,
    t: translator(bootstrap.strings),
    state: (id) => states.get(id),
    error: (id) => errors.get(id),
    meta: (id) => bootstrap.meta[id],
    core: (section) => core[section],
    subscribe(listener) {
      subscribers.add(listener);
      return () => void subscribers.delete(listener);
    },
    setEnabled: (id, enabled) => bridge.invoke("plugin:set-enabled", id, enabled),
    setConfig: (id, patch) => bridge.invoke("plugin:set-config", id, patch),
    setCoreConfig: (section, patch) => bridge.invoke("core:set-config", section, patch),
    relaunch: () => bridge.invoke("app:relaunch"),
    showSettingsFile: () => bridge.invoke("app:show-settings-file"),
    toggleDevTools: () => bridge.invoke("app:toggle-devtools"),
  };
}
