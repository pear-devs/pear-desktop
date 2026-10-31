// The pieces of a running page part's context. Each is the runtime's shared
// thing (player, audio graph, DOM helpers) scoped to the plugin: whatever it
// registers through them is undone when the plugin stops.

import type {
  AudioGraph as AudioGraphApi,
  Cleanup,
  HostClient,
  PageContext,
  PagePlayer,
  SelectorName,
  StyleHandle,
  Unsubscribe,
} from "@pear/sdk";
import { keepMounted, observe } from "@pear/sdk/dom";
import type { Bridge } from "@pear/sdk/protocol";
import { selectors } from "@pear/sdk/selectors";
import { adoptSheet, dropSheets, styleSheet } from "@pear/sdk/stylesheets";
import { CleanupStack, timerSet } from "@pear/sdk/util";
import type { AudioGraph } from "./audio.ts";
import { waitForSelector } from "./dom.ts";
import type { Player } from "./player.ts";

export type AnyConfig = Record<string, unknown>;
export type AnyCommands = Record<string, (...args: unknown[]) => unknown>;
export type AnyContext = PageContext<AnyConfig, AnyCommands>;
export type ConfigListener = (config: Readonly<AnyConfig>) => void | "restart";
export type EventListener = (payload: unknown) => void;
export type RequestHandler = (payload: unknown) => unknown;

/** What a running page part registered; `stop` undoes all of it. */
export class Scope {
  readonly #id: string;
  readonly #controller = new AbortController();
  readonly #cleanups = new CleanupStack((error) => console.error(`[pear:${this.#id}] cleanup failed`, error));
  /** The plugin's `style`; see `PluginRunner`. */
  pluginSheet: CSSStyleSheet | undefined;
  /** Sheets from `ctx.addStyle`. */
  sheets: CSSStyleSheet[] = [];
  /** Registered with `ctx.onConfigChange`; they replace restarting. */
  readonly configListeners: ConfigListener[] = [];

  constructor(id: string) {
    this.#id = id;
  }

  get signal() {
    return this.#controller.signal;
  }

  /** Runs `cleanup` when the plugin stops, or now if it already did. */
  onStop(cleanup: Cleanup) {
    this.#cleanups.add(cleanup);
  }

  /** `onStop(unsubscribe)`, returning an unsubscribe that also forgets it. */
  track = (unsubscribe: Unsubscribe): Unsubscribe => this.#cleanups.track(unsubscribe);

  stop() {
    this.#controller.abort(new DOMException(`plugin ${this.#id} stopped`, "AbortError"));
    this.#cleanups.run();
    dropSheets(this.pluginSheet ? [this.pluginSheet, ...this.sheets] : this.sheets);
    this.pluginSheet = undefined;
    this.sheets = [];
  }
}

type Track = Scope["track"];

/** The same player, but listeners are removed when the plugin stops. */
export function scopedPlayer(player: Player, track: Track): PagePlayer {
  return {
    get api() {
      return player.api;
    },
    get state() {
      return player.state;
    },
    ready: () => player.ready(),
    videoReady: () => player.videoReady(),
    video: () => player.video(),
    on: (event, listener) => track(player.on(event, listener)),
    control: (action) => player.control(action),
  };
}

/** The same graph, but stages and taps are removed when the plugin stops. */
export function scopedAudio(graph: AudioGraph, track: Track): AudioGraphApi {
  return {
    context: graph.context,
    source: graph.source,
    video: graph.video,
    insert: (input, output, order) => track(graph.insert(input, output, order)),
    tap: (node) => track(graph.tap(node)),
  };
}

/** `ctx.host`: commands, events and requests of the plugin's host part. */
export function hostClient(
  id: string,
  bridge: Bridge,
  listeners: Map<string, Set<EventListener>>,
  handlers: Map<string, RequestHandler>,
  track: Track,
): HostClient<AnyCommands> {
  return {
    invoke: (command, ...args) => bridge.invoke("plugin:invoke", id, command, args),
    on(event, listener) {
      const set = getOrCreate(listeners, event, () => new Set());
      set.add(listener);
      return track(() => set.delete(listener));
    },
    handle(event, handler) {
      handlers.set(event, handler);
      return track(() => {
        if (handlers.get(event) === handler) handlers.delete(event);
      });
    },
  };
}

/** `ctx.addStyle`: a sheet before the themes, for the plugin's lifetime. */
export function styleHandle(scope: Scope, css: string): StyleHandle {
  const sheet = styleSheet(css);
  // Added by a stopped plugin (after an await in `start`): nothing would drop it.
  if (scope.signal.aborted) return { update: (next) => sheet.replaceSync(next), remove: () => {} };
  adoptSheet(sheet);
  scope.sheets.push(sheet);
  return {
    update: (next) => sheet.replaceSync(next),
    remove: () => {
      scope.sheets = scope.sheets.filter((s) => s !== sheet);
      dropSheets([sheet]);
    },
  };
}

type DomHelpers = Pick<AnyContext, "sel" | "$" | "$$" | "waitFor" | "mount" | "observe" | "listen">;

/** The registry selectors and DOM helpers, with observers and listeners removed when the plugin stops. */
export function domHelpers(scope: Scope): DomHelpers {
  const { signal, track } = scope;
  return {
    sel: (name) => selectors[name],
    $: <E extends Element>(name: SelectorName, root: ParentNode = document) => root.querySelector<E>(selectors[name]),
    $$: <E extends Element>(name: SelectorName, root: ParentNode = document) => [...root.querySelectorAll<E>(selectors[name])],
    waitFor: <E extends Element>(name: SelectorName, options = {}) =>
      waitForSelector<E>(selectors[name], { ...options, signal }),
    mount(element: Element, place: SelectorName | ((element: Element) => void), position: "prepend" | "append" = "append") {
      const put = typeof place === "function" ? place : (el: Element) => document.querySelector(selectors[place])?.[position](el);
      track(keepMounted(element, put));
    },
    observe(target, options, callback) {
      if (typeof target !== "string") return void track(observe(target, options, callback));
      waitForSelector(selectors[target], { signal }).then(
        (element) => track(observe(element, options, callback)),
        () => {},
      );
    },
    listen: (target, type, listener, options) => target.addEventListener(type, listener, { ...options, signal }),
  };
}

/** setTimeout / setInterval, cleared when the plugin stops. */
export function timers(track: Track): Pick<AnyContext, "setTimeout" | "setInterval" | "clearTimeout" | "clearInterval"> {
  const { stop, ...timers } = timerSet();
  track(stop);
  return timers;
}

/** `map.get(key)`, creating the entry first if needed. */
export function getOrCreate<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  let value = map.get(key);
  if (value === undefined) {
    value = create();
    map.set(key, value);
  }
  return value;
}
