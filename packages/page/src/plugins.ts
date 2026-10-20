// Runs page parts of plugins: start/stop on enable, live config updates,
// per-plugin styles and automatic cleanup of everything a plugin registered.

import type {
  AnyPlugin,
  Cleanup,
  Logger,
  PageContext,
  PagePartObject,
  PagePlayer,
  SelectorName,
  Unsubscribe,
} from "@pear/sdk";
import type { CoreSection } from "@pear/sdk/core-config";
import type { Bridge, CoreState, PluginState } from "@pear/sdk/protocol";
import { selectors } from "@pear/sdk/selectors";
import { AudioGraph } from "./audio.ts";
import { domReady, waitForSelector } from "./dom.ts";
import type { Player } from "./player.ts";

type AnyContext = PageContext<Record<string, unknown>, Record<string, (...args: any[]) => unknown>>;

interface Instance {
  controller: AbortController;
  cleanups: Cleanup[];
  sheets: CSSStyleSheet[];
  ctx: AnyContext;
}

export class PluginRunner {
  #plugins = new Map<string, AnyPlugin>();
  #states = new Map<string, PluginState>();
  #instances = new Map<string, Instance>();
  #listeners = new Map<string, Map<string, Set<(payload: unknown) => void>>>();
  #errors = new Map<string, string>();
  // Host errors are only cleared by the host (an empty message), not by restarting the page part.
  #hostErrors = new Map<string, string>();
  #subscribers = new Set<() => void>();
  #handlers = new Map<string, Map<string, (payload: unknown) => unknown>>();
  #audio: Promise<AudioGraph> | undefined;
  #core: Record<CoreSection, CoreState>;
  #bridge: Bridge;
  #player: Player;

  constructor(plugins: readonly AnyPlugin[], bridge: Bridge, player: Player) {
    this.#bridge = bridge;
    this.#player = player;
    for (const plugin of plugins) {
      const state = bridge.bootstrap.plugins[plugin.id];
      // Plugins the host doesn't run on this platform are not offered at all.
      if (!state) continue;
      this.#plugins.set(plugin.id, plugin);
      this.#states.set(plugin.id, state);
    }
    for (const [id, message] of Object.entries(bridge.bootstrap.errors)) this.#hostErrors.set(id, message);
    this.#core = { ...bridge.bootstrap.core };
  }

  /** A core settings section (e.g. the API server). */
  core(section: CoreSection): CoreState {
    return this.#core[section];
  }

  setCoreConfig(section: CoreSection, patch: Record<string, unknown>) {
    return this.#bridge.invoke("core:set-config", section, patch);
  }

  applyCore(section: CoreSection, state: CoreState) {
    this.#core[section] = state;
    this.#notify();
  }

  /** Answers host requests for the core (id "core"), e.g. the API server's. */
  handleCore(event: string, handler: (payload: unknown) => unknown) {
    let handlers = this.#handlers.get("core");
    if (!handlers) this.#handlers.set("core", (handlers = new Map()));
    handlers.set(event, handler);
  }

  get plugins(): readonly AnyPlugin[] {
    return [...this.#plugins.values()];
  }

  state(id: string) {
    return this.#states.get(id);
  }

  error(id: string) {
    return this.#hostErrors.get(id) ?? this.#errors.get(id);
  }

  meta(id: string) {
    return this.#bridge.bootstrap.meta[id];
  }

  /** Notified on any state or error change (for the settings UI). */
  subscribe(listener: () => void) {
    this.#subscribers.add(listener);
    return () => void this.#subscribers.delete(listener);
  }

  setEnabled(id: string, enabled: boolean) {
    return this.#bridge.invoke("plugin:set-enabled", id, enabled);
  }

  setConfig(id: string, patch: Record<string, unknown>) {
    return this.#bridge.invoke("plugin:set-config", id, patch);
  }

  relaunch() {
    return this.#bridge.invoke("app:relaunch");
  }

  get version() {
    return this.#bridge.bootstrap.version;
  }

  reportError(id: string, message: string, source: "host" | "page" = "page") {
    const errors = source === "host" ? this.#hostErrors : this.#errors;
    if (message) errors.set(id, message);
    else errors.delete(id);
    this.#notify();
  }

  #notify() {
    for (const subscriber of this.#subscribers) subscriber();
  }

  startEnabled() {
    for (const [id, state] of this.#states) if (state.enabled) void this.#start(id);
  }

  /** Applies a state pushed by the host (enable/disable or config change). */
  applyState(id: string, next: PluginState) {
    const plugin = this.#plugins.get(id);
    const previous = this.#states.get(id);
    this.#states.set(id, next);
    this.#notify();
    if (!plugin) return;
    if (!next.enabled) return this.#stop(id);
    const instance = this.#instances.get(id);
    if (!instance) return void this.#start(id);
    if (previous && sameConfig(previous.config, next.config)) return;

    this.#renderStyle(plugin, instance);
    const part = pagePart(plugin);
    if (!part) return;
    const result = part.onConfigChange ? part.onConfigChange(next.config, instance.ctx) : "restart";
    if (result === "restart") {
      this.#stop(id);
      void this.#start(id);
    }
  }

  /** Answers a host `ctx.request` with the page part's handler. */
  async request(id: string, event: string, payload: unknown, requestId: number) {
    const handler = this.#handlers.get(id)?.get(event);
    try {
      if (!handler) throw new Error(`no handler for "${event}" (plugin not running in the page?)`);
      const value = await handler(payload);
      await this.#bridge.invoke("plugin:respond", requestId, true, value);
    } catch (error) {
      await this.#bridge.invoke("plugin:respond", requestId, false, error instanceof Error ? error.message : String(error));
    }
  }

  #audioGraph() {
    this.#audio ??= this.#player.ready().then(async () => {
      let video = this.#player.video();
      while (!video) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        video = this.#player.video();
      }
      return new AudioGraph(video);
    });
    return this.#audio;
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
    if (this.#errors.delete(id)) this.#notify();
    this.#renderStyle(plugin, instance);

    const part = pagePart(plugin);
    if (!part) return;
    try {
      if (part.runAt !== "start") await domReady();
      if (instance.controller.signal.aborted) return;
      const cleanup = await part.start(instance.ctx);
      if (typeof cleanup === "function") {
        if (instance.controller.signal.aborted) cleanup();
        else instance.cleanups.push(cleanup);
      }
    } catch (error) {
      if (!instance.controller.signal.aborted) {
        console.error(`[pear:${id}] failed to start`, error);
        this.reportError(id, `failed to start: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  #stop(id: string) {
    const instance = this.#instances.get(id);
    if (!instance) return;
    this.#instances.delete(id);
    instance.controller.abort(new DOMException(`plugin ${id} stopped`, "AbortError"));
    for (const cleanup of instance.cleanups.reverse()) {
      try {
        cleanup();
      } catch (error) {
        console.error(`[pear:${id}] cleanup failed`, error);
      }
    }
    this.#removeSheets(instance);
    this.#listeners.delete(id);
    this.#handlers.delete(id);
  }

  #renderStyle(plugin: AnyPlugin, instance: Instance) {
    if (!plugin.style) return;
    const config = this.#states.get(plugin.id)?.config ?? {};
    const css = typeof plugin.style === "function" ? plugin.style(config) : plugin.style;
    const [sheet] = instance.sheets;
    if (sheet) {
      sheet.replaceSync(css);
    } else {
      instance.sheets.push(this.#addSheet(css));
    }
  }

  #addSheet(css: string) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    return sheet;
  }

  #removeSheets(instance: Instance) {
    const removed = new Set(instance.sheets);
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((sheet) => !removed.has(sheet));
    instance.sheets = [];
  }

  #createInstance(plugin: AnyPlugin): Instance {
    const id = plugin.id;
    const controller = new AbortController();
    const cleanups: Cleanup[] = [];
    const instance: Instance = { controller, cleanups, sheets: [], ctx: undefined! };
    const runner = this;
    const bridge = this.#bridge;
    const log = logger(id);
    const listen = (target: EventTarget, type: string, listener: (event: any) => void, options?: AddEventListenerOptions) =>
      target.addEventListener(type, listener, { ...options, signal: controller.signal });
    const track = (unsubscribe: Unsubscribe) => {
      cleanups.push(unsubscribe);
      return unsubscribe;
    };

    // Same player, but listeners are removed when the plugin stops.
    const player = this.#player;
    const scopedPlayer: PagePlayer = {
      get api() {
        return player.api;
      },
      get state() {
        return player.state;
      },
      ready: () => player.ready(),
      video: () => player.video(),
      on: ((event: never, listener: never) => track(player.on(event, listener))) as PagePlayer["on"],
      control: (action) => player.control(action),
    };

    instance.ctx = {
      id,
      get config() {
        return (runner.#states.get(id)?.config ?? {}) as Record<string, unknown>;
      },
      setConfig(patch) {
        const state = runner.#states.get(id);
        if (state) runner.#states.set(id, { ...state, config: { ...state.config, ...patch } });
        void bridge.invoke("plugin:set-config", id, patch);
      },
      player: scopedPlayer,
      host: {
        invoke: ((command: string, ...args: unknown[]) => bridge.invoke("plugin:invoke", id, command, args)) as any,
        on(event, listener) {
          let events = runner.#listeners.get(id);
          if (!events) runner.#listeners.set(id, (events = new Map()));
          let set = events.get(event);
          if (!set) events.set(event, (set = new Set()));
          set.add(listener);
          return track(() => set.delete(listener));
        },
        handle(event, handler) {
          let handlers = runner.#handlers.get(id);
          if (!handlers) runner.#handlers.set(id, (handlers = new Map()));
          handlers.set(event, handler);
          return track(() => {
            if (handlers.get(event) === handler) handlers.delete(event);
          });
        },
      },
      async audio() {
        const graph = await runner.#audioGraph();
        // Same graph, but stages and taps are removed when the plugin stops.
        return {
          context: graph.context,
          source: graph.source,
          video: graph.video,
          insert: (input, output, order) => track(graph.insert(input, output, order)),
          tap: (node) => track(graph.tap(node)),
        };
      },
      sel: (name: SelectorName) => selectors[name],
      $: (name: SelectorName, root: ParentNode = document) => root.querySelector(selectors[name]) as any,
      $$: (name: SelectorName, root: ParentNode = document) => [...root.querySelectorAll(selectors[name])] as any,
      waitFor: (name: SelectorName, options = {}) =>
        waitForSelector(selectors[name], { ...options, signal: controller.signal }) as any,
      listen,
      addStyle(css) {
        const sheet = runner.#addSheet(css);
        instance.sheets.push(sheet);
        return {
          update: (next) => sheet.replaceSync(next),
          remove: () => {
            instance.sheets = instance.sheets.filter((s) => s !== sheet);
            document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet);
          },
        };
      },
      onCleanup(fn) {
        cleanups.push(fn);
      },
      signal: controller.signal,
      log,
    };
    return instance;
  }
}

function pagePart(plugin: AnyPlugin): PagePartObject<any, any> | undefined {
  const page = plugin.page;
  if (!page) return;
  return typeof page === "function" ? { start: page } : page;
}

function sameConfig(a: Record<string, unknown>, b: Record<string, unknown>) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function logger(id: string): Logger {
  const prefix = `[pear:${id}]`;
  return {
    info: (...args) => console.info(prefix, ...args),
    warn: (...args) => console.warn(prefix, ...args),
    error: (...args) => console.error(prefix, ...args),
  };
}
