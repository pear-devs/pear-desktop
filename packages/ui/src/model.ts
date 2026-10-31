// What the settings UI reads and changes. The page runtime implements it in
// YTM; `bridgeModel` implements it over the bare bridge for the
// standalone settings window.

import type { CoreSection, Flags } from "@pear/sdk/core-config";
import { type Translate, translator } from "@pear/sdk/i18n";
import type {
  AppInfo,
  Bootstrap,
  Bridge,
  CoreState,
  HostEvent,
  PluginInfo,
  PluginMeta,
  PluginState,
} from "@pear/sdk/protocol";

export interface SettingsModel {
  readonly app: AppInfo;
  readonly plugins: readonly PluginInfo[];
  /** The active language's strings. */
  readonly t: Translate;
  state(id: string): PluginState | undefined;
  error(id: string): string | undefined;
  /** What the plugin's host part says it is doing. */
  status(id: string): string | undefined;
  meta(id: string): PluginMeta | undefined;
  core(section: CoreSection): CoreState | undefined;
  subscribe(listener: () => void): () => void;
  setEnabled(id: string, enabled: boolean): Promise<unknown>;
  setConfig(id: string, patch: Record<string, unknown>): Promise<unknown>;
  setCoreConfig(section: CoreSection, patch: Record<string, unknown>): Promise<unknown>;
  relaunch(): Promise<unknown>;
  showSettingsFile(): Promise<unknown>;
  toggleDevTools(): Promise<unknown>;
  /** Runs one of the plugin's settings actions (its host command of that name). */
  runAction(id: string, name: string): Promise<unknown>;
  /** YTM's feature flags as it served them; only in YTM's page. */
  siteFlags?(): Readonly<Flags>;
}

/** The model's commands, each a request to the host. */
type SettingsCommands = Pick<
  SettingsModel,
  "setEnabled" | "setConfig" | "setCoreConfig" | "relaunch" | "showSettingsFile" | "toggleDevTools" | "runAction"
>;

function bridgeCommands(bridge: Bridge): SettingsCommands {
  return {
    setEnabled: (id, enabled) => bridge.invoke("plugin:set-enabled", id, enabled),
    setConfig: (id, patch) => bridge.invoke("plugin:set-config", id, patch),
    setCoreConfig: (section, patch) => bridge.invoke("core:set-config", section, patch),
    relaunch: () => bridge.invoke("app:relaunch"),
    showSettingsFile: () => bridge.invoke("app:show-settings-file"),
    toggleDevTools: () => bridge.invoke("app:toggle-devtools"),
    runAction: (id, name) => bridge.invoke("plugin:invoke", id, name, []),
  };
}

/**
 * What the host says about plugins and the core: plugin states, host errors,
 * status lines and core sections, from the bootstrap on. Setters notify subscribers.
 */
export class HostState {
  readonly plugins: Map<string, PluginState>;
  readonly errors: Map<string, string>;
  readonly statuses: Map<string, string>;
  readonly core: Record<CoreSection, CoreState>;
  #subscribers = new Set<() => void>();

  constructor(bootstrap: Bootstrap) {
    this.plugins = new Map(Object.entries(bootstrap.plugins));
    this.errors = new Map(Object.entries(bootstrap.errors));
    this.statuses = new Map(Object.entries(bootstrap.statuses ?? {}));
    this.core = { ...bootstrap.core };
  }

  setPlugin(id: string, state: PluginState) {
    this.plugins.set(id, state);
    this.notify();
  }

  /** An empty message clears the error. */
  setError(id: string, message: string) {
    setMessage(this.errors, id, message);
    this.notify();
  }

  /** An empty message clears the status line. */
  setStatus(id: string, message: string) {
    setMessage(this.statuses, id, message);
    this.notify();
  }

  setCore(section: CoreSection, state: CoreState) {
    this.core[section] = state;
    this.notify();
  }

  /** Applies a host event about any of the above; ignores the others. */
  apply(event: HostEvent) {
    switch (event.type) {
      case "plugin-state":
        return this.setPlugin(event.id, event.state);
      case "plugin-error":
        return this.setError(event.id, event.message);
      case "plugin-status":
        return this.setStatus(event.id, event.message);
      case "core-state":
        return this.setCore(event.section, event.state);
    }
  }

  subscribe(listener: () => void) {
    this.#subscribers.add(listener);
    return () => void this.#subscribers.delete(listener);
  }

  notify() {
    for (const listener of this.#subscribers) listener();
  }
}

/** Sets `id`'s message; an empty one removes it. */
export function setMessage(messages: Map<string, string>, id: string, message: string) {
  if (message) messages.set(id, message);
  else messages.delete(id);
}

/**
 * The settings model over `host` and the bridge's commands. `error` defaults to
 * the host's errors (the page runtime adds its own).
 */
export function settingsModel(
  bridge: Bridge,
  host: HostState,
  error: (id: string) => string | undefined = (id) => host.errors.get(id),
): SettingsModel {
  const { bootstrap } = bridge;
  return {
    ...bridgeCommands(bridge),
    app: bootstrap.app,
    plugins: bootstrap.catalog,
    t: translator(bootstrap.strings),
    state: (id) => host.plugins.get(id),
    error,
    status: (id) => host.statuses.get(id),
    meta: (id) => bootstrap.meta[id],
    core: (section) => host.core[section],
    subscribe: (listener) => host.subscribe(listener),
  };
}

/** A model over the bridge alone, for the standalone window (no page runtime). */
export function bridgeModel(bridge: Bridge): SettingsModel {
  const host = new HostState(bridge.bootstrap);
  bridge.onEvent((event) => host.apply(event));
  return settingsModel(bridge, host);
}
