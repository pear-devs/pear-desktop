// Runs host parts of plugins and keeps the page in sync: enabling, disabling
// and config changes apply live in both processes, no restart needed.

import { type App, type BrowserWindow, type Session } from "electron";
import { type AnyPlugin, type Cleanup, type HostContext, type Logger, supportsPlatform } from "@pear/sdk";
import type { HostEvent, PluginState } from "@pear/sdk/protocol";
import type { Settings } from "./config.ts";
import type { PlayerMirror } from "./player.ts";

interface Instance {
  ctx: HostContext<Record<string, unknown>>;
  cleanups: Cleanup[];
  stopped: boolean;
}

export interface HostEnvironment {
  app: App;
  window: BrowserWindow;
  session: Session;
  player: PlayerMirror;
  send(event: HostEvent): void;
}

export class PluginHost {
  readonly plugins: readonly AnyPlugin[];
  #byId: Map<string, AnyPlugin>;
  #settings: Settings;
  #instances = new Map<string, Instance>();
  #env: HostEnvironment | undefined;

  constructor(plugins: readonly AnyPlugin[], settings: Settings, platform: string) {
    this.plugins = plugins.filter((plugin) => supportsPlatform(plugin, platform));
    this.#byId = new Map(this.plugins.map((plugin) => [plugin.id, plugin]));
    this.#settings = settings;
  }

  get(id: string) {
    return this.#byId.get(id);
  }

  states(): Record<string, PluginState> {
    const all = this.#settings.allPlugins();
    return Object.fromEntries(this.plugins.map((p) => [p.id, all[p.id]!]));
  }

  /** Runs plugins' beforeReady hooks; returns the Chromium features they asked for. */
  beforeReady(app: App) {
    const enabled = new Set<string>();
    const disabled = new Set<string>();
    for (const plugin of this.plugins) {
      const state = this.#settings.plugin(plugin.id);
      if (!state?.enabled || !plugin.host?.beforeReady) continue;
      try {
        plugin.host.beforeReady({
          config: state.config,
          app,
          enableFeatures: (...features) => features.forEach((f) => enabled.add(f)),
          disableFeatures: (...features) => features.forEach((f) => disabled.add(f)),
        });
      } catch (error) {
        logger(plugin.id).error("beforeReady failed", error);
      }
    }
    return { enabled, disabled };
  }

  attach(env: HostEnvironment) {
    this.#env = env;
    for (const plugin of this.plugins) {
      if (this.#settings.plugin(plugin.id)?.enabled) void this.#start(plugin);
    }
  }

  async setEnabled(id: string, enabled: boolean) {
    const plugin = this.#require(id);
    const state = this.#settings.setPlugin(plugin, { enabled });
    if (enabled) await this.#start(plugin);
    else this.#stop(id);
    this.#broadcast(id, state);
    return state;
  }

  async setConfig(id: string, patch: Record<string, unknown>) {
    const plugin = this.#require(id);
    const before = JSON.stringify(this.#settings.plugin(id)?.config);
    const state = this.#settings.setPlugin(plugin, { config: patch });
    if (JSON.stringify(state.config) === before) return state;

    const instance = this.#instances.get(id);
    if (instance && plugin.host) {
      const result = plugin.host.onConfigChange
        ? plugin.host.onConfigChange(state.config, instance.ctx)
        : plugin.host.start
          ? "restart"
          : undefined;
      if (result === "restart") {
        this.#stop(id);
        await this.#start(plugin);
      }
    }
    this.#broadcast(id, state);
    return state;
  }

  async invoke(id: string, command: string, args: unknown[]) {
    const plugin = this.#require(id);
    const instance = this.#instances.get(id);
    const handler = plugin.host?.commands?.[command] as ((...a: unknown[]) => unknown) | undefined;
    if (!instance || !handler || !Object.hasOwn(plugin.host!.commands!, command)) {
      throw new Error(`[pear] ${id}: no command "${command}" (or plugin disabled)`);
    }
    return handler.apply(instance.ctx, args);
  }

  stopAll() {
    for (const id of [...this.#instances.keys()]) this.#stop(id);
  }

  #require(id: string) {
    const plugin = this.#byId.get(id);
    if (!plugin) throw new Error(`[pear] unknown plugin: ${id}`);
    return plugin;
  }

  #broadcast(id: string, state: PluginState) {
    this.#env?.send({ type: "plugin-state", id, state });
  }

  async #start(plugin: AnyPlugin) {
    const env = this.#env;
    if (!env || !plugin.host || this.#instances.has(plugin.id)) return;
    const instance = this.#createInstance(plugin, env);
    this.#instances.set(plugin.id, instance);
    try {
      const cleanup = await plugin.host.start?.(instance.ctx);
      if (typeof cleanup === "function") {
        if (instance.stopped) cleanup();
        else instance.cleanups.push(cleanup);
      }
    } catch (error) {
      instance.ctx.log.error("failed to start", error);
    }
  }

  #stop(id: string) {
    const instance = this.#instances.get(id);
    if (!instance) return;
    this.#instances.delete(id);
    instance.stopped = true;
    for (const cleanup of instance.cleanups.reverse()) {
      try {
        cleanup();
      } catch (error) {
        instance.ctx.log.error("cleanup failed", error);
      }
    }
  }

  #createInstance(plugin: AnyPlugin, env: HostEnvironment): Instance {
    const id = plugin.id;
    const settings = this.#settings;
    const host = this;
    const cleanups: Cleanup[] = [];
    const instance: Instance = { cleanups, stopped: false, ctx: undefined! };
    const player = env.player;
    instance.ctx = {
      id,
      get config() {
        return settings.plugin(id)?.config ?? {};
      },
      setConfig: (patch) => void host.setConfig(id, patch),
      app: env.app,
      window: env.window,
      session: env.session,
      player: {
        get state() {
          return player.state;
        },
        on: ((event: "change", listener: never) => {
          const off = player.on(event, listener);
          cleanups.push(off);
          return off;
        }) as HostContext<unknown>["player"]["on"],
        control: (action) => player.control(action),
      },
      emit: (event, payload) => env.send({ type: "plugin-event", id, event, payload }),
      onCleanup: (fn) => cleanups.push(fn),
      log: logger(id),
    };
    return instance;
  }
}

function logger(id: string): Logger {
  const prefix = `[pear:${id}]`;
  return {
    info: (...args) => console.info(prefix, ...args),
    warn: (...args) => console.warn(prefix, ...args),
    error: (...args) => console.error(prefix, ...args),
  };
}
