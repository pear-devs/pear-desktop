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
import type { Bridge, PluginState } from "@pear/sdk/protocol";
import { selectors } from "@pear/sdk/selectors";
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
  #bridge: Bridge;
  #player: Player;

  constructor(plugins: readonly AnyPlugin[], bridge: Bridge, player: Player) {
    this.#bridge = bridge;
    this.#player = player;
    for (const plugin of plugins) {
      this.#plugins.set(plugin.id, plugin);
      const state = bridge.bootstrap.plugins[plugin.id];
      if (state) this.#states.set(plugin.id, state);
    }
  }

  get plugins(): readonly AnyPlugin[] {
    return [...this.#plugins.values()];
  }

  state(id: string) {
    return this.#states.get(id);
  }

  startEnabled() {
    for (const [id, state] of this.#states) if (state.enabled) void this.#start(id);
  }

  /** Applies a state pushed by the host (enable/disable or config change). */
  applyState(id: string, next: PluginState) {
    const plugin = this.#plugins.get(id);
    const previous = this.#states.get(id);
    this.#states.set(id, next);
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
      if (!instance.controller.signal.aborted) console.error(`[pear:${id}] failed to start`, error);
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
      },
      sel: (name: SelectorName) => selectors[name],
      $: (name: SelectorName, root: ParentNode = document) => root.querySelector(selectors[name]) as any,
      $$: (name: SelectorName, root: ParentNode = document) => [...root.querySelectorAll(selectors[name])] as any,
      waitFor: (name: SelectorName, options = {}) =>
        waitForSelector(selectors[name], { ...options, signal: controller.signal }) as any,
      listen,
      addStyle(css) {
        instance.sheets.push(runner.#addSheet(css));
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
