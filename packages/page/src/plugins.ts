// Runs page parts of plugins: start/stop on enable, live config updates,
// per-plugin styles and automatic cleanup of everything a plugin registered.

import type { AnyPlugin, PagePartObject } from "@pear/sdk";
import type { CoreSection } from "@pear/sdk/core-config";
import { type Translate, translator } from "@pear/sdk/i18n";
import type { Bridge, CoreState, PluginState } from "@pear/sdk/protocol";
import { adoptSheet, styleSheet } from "@pear/sdk/stylesheets";
import { createLogger, errorMessage } from "@pear/sdk/util";
import { HostState, type SettingsModel, setMessage, settingsModel } from "@pear/ui";
import { AudioGraph } from "./audio.ts";
import {
  type AnyCommands,
  type AnyConfig,
  type AnyContext,
  domHelpers,
  type EventListener,
  getOrCreate,
  hostClient,
  type RequestHandler,
  Scope,
  scopedAudio,
  scopedPlayer,
  styleHandle,
  timers,
} from "./context.ts";
import { domReady } from "./dom.ts";
import type { Player } from "./player.ts";
import { showToast } from "./toast.ts";

type PagePartOf = PagePartObject<AnyConfig, AnyCommands>;

interface Instance {
  scope: Scope;
  ctx: AnyContext;
}

export class PluginRunner {
  #plugins = new Map<string, AnyPlugin>();
  #instances = new Map<string, Instance>();
  /** States, host errors and status lines, as the host reports them. */
  #host: HostState;
  /** Page parts that failed to start; cleared when they start again (host errors only by the host). */
  #pageErrors = new Map<string, string>();
  #listeners = new Map<string, Map<string, Set<EventListener>>>();
  #handlers = new Map<string, Map<string, RequestHandler>>();
  #audio: Promise<AudioGraph> | undefined;
  #windowVisible: boolean;
  #bridge: Bridge;
  #player: Player;
  /** The active language's strings, from the host. */
  readonly t: Translate;
  /** What the settings UI reads and changes. */
  readonly settings: SettingsModel;

  constructor(plugins: readonly AnyPlugin[], bridge: Bridge, player: Player) {
    this.#bridge = bridge;
    this.#player = player;
    this.#host = new HostState(bridge.bootstrap);
    // Plugins the host doesn't run on this platform are not offered at all.
    for (const plugin of plugins) if (this.#host.plugins.has(plugin.id)) this.#plugins.set(plugin.id, plugin);
    this.t = translator(bridge.bootstrap.strings);
    this.#windowVisible = bridge.bootstrap.windowVisible ?? true;
    this.settings = settingsModel(bridge, this.#host, (id) => this.error(id));
  }

  /** What the settings UI lists (from the host, which knows every plugin's schema). */
  get plugins() {
    return this.#bridge.bootstrap.catalog;
  }

  state(id: string) {
    return this.#host.plugins.get(id);
  }

  error(id: string) {
    return this.#host.errors.get(id) ?? this.#pageErrors.get(id);
  }

  /** The host part's status line (`ctx.setStatus`). */
  status(id: string) {
    return this.#host.statuses.get(id);
  }

  applyStatus(id: string, message: string) {
    this.#host.setStatus(id, message);
  }

  reportError(id: string, message: string, source: "host" | "page" = "page") {
    if (source === "host") return this.#host.setError(id, message);
    setMessage(this.#pageErrors, id, message);
    this.#host.notify();
  }

  /** A core settings section (e.g. the API server). */
  core(section: CoreSection): CoreState {
    return this.#host.core[section];
  }

  applyCore(section: CoreSection, state: CoreState) {
    this.#host.setCore(section, state);
  }

  /** Whether the window is on screen (`ctx.isWindowVisible`). */
  get windowVisible() {
    return this.#windowVisible;
  }

  setWindowVisible(visible: boolean) {
    this.#windowVisible = visible;
  }

  /** Answers host requests for the core (id "core"), e.g. the API server's. */
  handleCore(event: string, handler: RequestHandler) {
    getOrCreate(this.#handlers, "core", () => new Map()).set(event, handler);
  }

  startEnabled() {
    for (const [id, state] of this.#host.plugins) if (state.enabled) void this.#start(id);
  }

  /** Applies a state pushed by the host (enable/disable or config change). */
  applyState(id: string, next: PluginState) {
    const plugin = this.#plugins.get(id);
    const previous = this.#host.plugins.get(id);
    this.#host.setPlugin(id, next);
    if (!plugin) return;
    const instance = this.#instances.get(id);
    // Started (or not) for good when the page loaded; the restart banner covers the rest.
    const settledAtLoad = plugin.restartRequired && (!instance || !next.enabled);
    if (settledAtLoad) return;
    if (!next.enabled) return this.#stop(id);
    if (!instance) return void this.#start(id);
    const configChanged = !previous || !sameConfig(previous.config, next.config);
    if (configChanged) this.#applyConfig(plugin, instance, next.config);
  }

  /** Answers a host `ctx.request` with the page part's handler. */
  async request(id: string, event: string, payload: unknown, requestId: number) {
    const handler = this.#handlers.get(id)?.get(event);
    try {
      if (!handler) throw new Error(`no handler for "${event}" (plugin not running in the page?)`);
      const value = await handler(payload);
      await this.#bridge.invoke("plugin:respond", requestId, true, value);
    } catch (error) {
      await this.#bridge.invoke("plugin:respond", requestId, false, errorMessage(error));
    }
  }

  dispatch(id: string, event: string, payload: unknown) {
    for (const listener of this.#listeners.get(id)?.get(event) ?? []) {
      try {
        listener(payload);
      } catch (error) {
        console.error(`[pear:${id}] event ${event} failed`, error);
      }
    }
  }

  async #start(id: string) {
    const plugin = this.#plugins.get(id);
    if (!plugin || this.#instances.has(id)) return;
    const instance = this.#createInstance(plugin);
    this.#instances.set(id, instance);
    if (this.#pageErrors.delete(id)) this.#host.notify();
    this.#renderStyle(plugin, instance.scope);
    const part = pagePart(plugin);
    if (part) await this.#run(id, part, instance);
  }

  async #run(id: string, part: PagePartOf, { scope, ctx }: Instance) {
    try {
      if (part.runAt !== "start") await domReady();
      if (scope.signal.aborted) return;
      const cleanup = await part.start(ctx);
      if (typeof cleanup !== "function") return;
      // Stopped while starting: the scope runs it at once.
      scope.onStop(cleanup);
    } catch (error) {
      if (scope.signal.aborted) return;
      console.error(`[pear:${id}] failed to start`, error);
      this.reportError(id, `failed to start: ${errorMessage(error)}`);
    }
  }

  #stop(id: string) {
    const instance = this.#instances.get(id);
    if (!instance) return;
    this.#instances.delete(id);
    instance.scope.stop();
    this.#listeners.delete(id);
    this.#handlers.delete(id);
  }

  /** Lets the running page part take a config change, or restarts it. */
  #applyConfig(plugin: AnyPlugin, instance: Instance, config: AnyConfig) {
    this.#renderStyle(plugin, instance.scope);
    const part = pagePart(plugin);
    if (part && configChange(part, instance, config) === "restart") {
      this.#stop(plugin.id);
      void this.#start(plugin.id);
    }
  }

  /** The plugin's `style`, for its current config. */
  #renderStyle(plugin: AnyPlugin, scope: Scope) {
    if (!plugin.style) return;
    const config = this.#host.plugins.get(plugin.id)?.config ?? {};
    const css = typeof plugin.style === "function" ? plugin.style(config) : plugin.style;
    if (scope.pluginSheet) return scope.pluginSheet.replaceSync(css);
    scope.pluginSheet = styleSheet(css);
    adoptSheet(scope.pluginSheet);
  }

  #audioGraph() {
    this.#audio ??= this.#player.videoReady().then((video) => new AudioGraph(video));
    return this.#audio;
  }

  #setConfig(id: string, patch: Partial<AnyConfig>) {
    const state = this.#host.plugins.get(id);
    // Readable right away; the host confirms with a plugin-state event.
    if (state) this.#host.plugins.set(id, { ...state, config: { ...state.config, ...patch } });
    void this.#bridge.invoke("plugin:set-config", id, patch);
  }

  #createInstance(plugin: AnyPlugin): Instance {
    const { id } = plugin;
    const scope = new Scope(id);
    const host = this.#host;
    const listeners = getOrCreate(this.#listeners, id, () => new Map());
    const handlers = getOrCreate(this.#handlers, id, () => new Map());
    const ctx: AnyContext = {
      id,
      get config() {
        return host.plugins.get(id)?.config ?? {};
      },
      setConfig: (patch) => this.#setConfig(id, patch),
      onConfigChange: (listener) => void scope.configListeners.push(listener),
      player: scopedPlayer(this.#player, scope.track),
      host: hostClient(id, this.#bridge, listeners, handlers, scope.track),
      audio: async () => scopedAudio(await this.#audioGraph(), scope.track),
      ...domHelpers(scope),
      ...timers(scope.track),
      addStyle: (css) => styleHandle(scope, css),
      toast: showToast,
      isWindowVisible: () => this.#windowVisible,
      onCleanup: (fn) => scope.onStop(fn),
      signal: scope.signal,
      t: this.t,
      log: createLogger(id),
    };
    return { scope, ctx };
  }
}

function pagePart(plugin: AnyPlugin): PagePartOf | undefined {
  const page = plugin.page;
  if (!page) return;
  return typeof page === "function" ? { start: page } : page;
}

function sameConfig(a: AnyConfig, b: AnyConfig) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Lets the running page part take a config change; "restart" when it can't. */
function configChange(part: PagePartOf, { scope, ctx }: Instance, config: AnyConfig) {
  if (scope.configListeners.length > 0) {
    const results = scope.configListeners.map((listener) => listener(config));
    return results.includes("restart") ? "restart" : undefined;
  }
  if (part.onConfigChange) return part.onConfigChange(config, ctx);
  return "restart";
}
