// @pear/sdk: everything a plugin needs. A plugin is one file exporting
// `definePlugin({...})`; the build splits it into a host (main process) part
// and a page (YTM main world) part, like #[cfg] in Rust.

import type { App, BrowserWindow, BrowserWindowConstructorOptions, Session, WebRequest } from "electron";
import { type ConfigOf, type ConfigShape, onPlatform } from "./config.ts";
import type { NowPlaying, PlayerAction, Track, PlaybackStatus, Unsubscribe, YTPlayerApi } from "./player.ts";
import type { RpcMethods, RpcSchemas } from "./rpc.ts";
import type { SelectorName } from "./selectors.ts";
import type { SongDetails } from "./song-details.ts";

export * from "./config.ts";
export * from "./player.ts";
export type { RpcMethod, RpcSchemas } from "./rpc.ts";
export type { SelectorName } from "./selectors.ts";

export type Platform = "linux" | "win32" | "darwin";
export type Cleanup = () => void;
type MaybePromise<T> = T | Promise<T>;
/** What `start` may return: nothing, or a cleanup to run when the plugin stops. */
type StartResult = MaybePromise<void | Cleanup>;

export interface Logger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

// `object`, not a Record: plugins describe their commands with interfaces, which have no index signature.
type AnyCommands = object;
type Args<F> = F extends (...args: infer A) => unknown ? A : never;
type Result<F> = F extends (...args: any[]) => infer R ? Awaited<R> : never;

/** Calls a command by name, with its parameters and result types. */
export type Invoke<Cmds> = <K extends keyof Cmds & string>(name: K, ...args: Args<Cmds[K]>) => Promise<Result<Cmds[K]>>;

/** The parts of a running plugin's context both sides share. */
interface CommonContext<C> {
  readonly id: string;
  /** Always the current config. */
  readonly config: Readonly<C>;
  setConfig(patch: Partial<C>): void;
  /**
   * Called with the new config instead of restarting the plugin; return "restart"
   * to restart anyway. Registered from `start`, so it sees `start`'s variables.
   */
  onConfigChange(listener: (config: Readonly<C>) => void | "restart"): void;
  /** setTimeout / setInterval, cleared when the plugin stops. */
  setTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout>;
  setInterval(fn: () => void, ms: number): ReturnType<typeof setInterval>;
  /** For timers from `ctx.setTimeout` / `ctx.setInterval`; plain clearTimeout works too, but the plugin then remembers the timer until it stops. */
  clearTimeout(timer: ReturnType<typeof setTimeout> | undefined): void;
  clearInterval(timer: ReturnType<typeof setInterval> | undefined): void;
  /** Runs when the plugin stops (disabled, restarted or app quit). */
  onCleanup(fn: Cleanup): void;
  /**
   * Translates a key from the translation files (src/i18n/resources), e.g.
   * `t("plugins.<id>.saved", "Saved “{{title}}”", { title })`. The
   * fallback is the English text; `nub run i18n` adds it to en.json.
   */
  t(key: string, fallback?: string, vars?: Readonly<Record<string, unknown>>): string;
  readonly log: Logger;
}

/** Node-style event emitters: Electron's app, windows, nativeTheme… */
export interface Emitter {
  on(event: string, listener: (...args: any[]) => void): unknown;
  removeListener(event: string, listener: (...args: any[]) => void): unknown;
}

// ---------------------------------------------------------------- host side

export interface HostPlayer {
  readonly state: NowPlaying;
  on(event: "change", listener: (state: NowPlaying, previous: NowPlaying) => void): Unsubscribe;
  on(event: "trackChange", listener: (track: Track | null, state: NowPlaying) => void): Unsubscribe;
  control(action: PlayerAction): void;
  /**
   * Extras of the current track the page knows (views, tags, alternative title…).
   * Null when there are none or the page doesn't answer within `timeout` ms (default 5000).
   */
  details(options?: { timeout?: number }): Promise<SongDetails | null>;
}

export interface HostContext<C> extends CommonContext<C> {
  readonly app: App;
  readonly window: BrowserWindow;
  /** The default session, except `webRequest` is this plugin's (see `webRequest`). */
  readonly session: Session;
  /**
   * Electron's WebRequest API, scoped to this plugin: listeners compose with
   * other plugins' instead of replacing them, and are removed when it stops.
   */
  readonly webRequest: WebRequest;
  readonly player: HostPlayer;
  /** Asks this plugin's page part (`ctx.host.handle`) and resolves with its answer. */
  request<T = unknown>(event: string, payload?: unknown, options?: { timeout?: number }): Promise<T>;
  /** Opens the in-page settings overlay (focusing the window). */
  openSettings(): void;
  /** Shows the main window and brings it to the front (restoring it if minimized). */
  focusWindow(): void;
  /**
   * Adds an item to the app menu (under Options) and the tray menu. It goes
   * when the plugin stops.
   */
  addMenuItem(item: PluginMenuItem): void;
  /** The items plugins added with `addMenuItem`, for a plugin that draws a menu of its own (the tray). */
  pluginMenuItems(): readonly PluginMenuItem[];
  /** Calls `listener` when plugins add or remove menu items. */
  onMenuItemsChange(listener: () => void): void;
  /** `target.on(event, listener)`, removed when the plugin stops. */
  listen(target: Emitter, event: string, listener: (...args: any[]) => void): void;
  /**
   * A short line on the plugin's settings card saying what it is doing, e.g.
   * "Downloading ffmpeg… 40%"; an empty string clears it, and so does stopping.
   */
  setStatus(message: string): void;
  /** Sends an event to this plugin's page part (`ctx.host.on`). */
  emit(event: string, payload?: unknown): void;
  /** The core API server. */
  readonly api: {
    /** Sends `{ type: "PLUGIN_EVENT", plugin, event, data }` to WebSocket clients; a no-op while the server is off. */
    broadcast(event: string, data?: unknown): void;
  };
  /**
   * Commands arriving through the app protocol (pear-desktop's "…music://playPause"
   * links, e.g. from Windows notification buttons), after the core applied them.
   */
  onProtocol(listener: (command: string, args: string[]) => void): void;
}

/** An item of the app and tray menus. */
export interface PluginMenuItem {
  label: string;
  /** A shortcut while the app is focused, e.g. "CmdOrCtrl+J". */
  accelerator?: string;
  click(): void;
}

export interface BeforeReadyContext<C> {
  readonly config: Readonly<C>;
  readonly app: App;
  /** Chromium features; collected from all plugins and applied once. */
  enableFeatures(...features: string[]): void;
  disableFeatures(...features: string[]): void;
}

export interface HostPart<C, Cmds extends AnyCommands, Rpc extends RpcSchemas = {}> {
  /** Runs before `app.whenReady()` when enabled at launch (command-line switches). Changes need a restart. */
  beforeReady?(ctx: BeforeReadyContext<C>): void;
  start?(ctx: HostContext<C>): StartResult;
  /** Default: restart the host part (unless `start` registered `ctx.onConfigChange`). */
  onConfigChange?(config: Readonly<C>, ctx: HostContext<C>): void | "restart";
  /** Options merged into the main window's constructor when enabled at launch (frame, transparency…). */
  windowOptions?(config: Readonly<C>): BrowserWindowConstructorOptions;
  /** Typed commands the page part can call with `ctx.host.invoke`. `this` is the host context. */
  commands?: Cmds & ThisType<HostContext<C>>;
  /**
   * Methods other apps can call through the API server, as
   * `POST /api/v1/plugins/<id>/<name>` with a JSON body checked against `input`.
   */
  rpc?: RpcMethods<Rpc, HostContext<C>>;
}

// ---------------------------------------------------------------- page side

export interface PagePlayer {
  /** YTM's player API once available. */
  readonly api: YTPlayerApi | null;
  ready(): Promise<YTPlayerApi>;
  /** YTM's <video> once it exists (YTM adds it a little after the player API). */
  videoReady(): Promise<HTMLVideoElement>;
  /** YTM's <video>, or null while there is none yet (see `videoReady`). */
  video(): HTMLVideoElement | null;
  readonly state: NowPlaying;
  /** Fires as soon as YTM starts loading a track, before its metadata is complete. */
  on(event: "trackLoading", listener: (videoId: string) => void): Unsubscribe;
  on(event: "trackChange", listener: (track: Track) => void): Unsubscribe;
  on(event: "statusChange", listener: (status: PlaybackStatus) => void): Unsubscribe;
  /** Once per second of track playback; never during ads. */
  on(event: "timeUpdate", listener: (seconds: number) => void): Unsubscribe;
  on(event: "adChange", listener: (ad: boolean) => void): Unsubscribe;
  on(event: "volumeChange", listener: (volume: number, muted: boolean) => void): Unsubscribe;
  on(event: "change", listener: (state: NowPlaying) => void): Unsubscribe;
  control(action: PlayerAction): void;
}

export interface HostClient<Cmds extends AnyCommands> {
  invoke: Invoke<Cmds>;
  on(event: string, listener: (payload: unknown) => void): Unsubscribe;
  /** Answers `ctx.request(event)` from the host part. */
  handle(event: string, handler: (payload: unknown) => unknown): Unsubscribe;
}

/**
 * The shared Web Audio graph: YTM's <video> → [inserted nodes by order] → speakers.
 * A media element can only have one source node, so every audio plugin goes through this.
 */
export interface AudioGraph {
  readonly context: AudioContext;
  readonly source: MediaElementAudioSourceNode;
  readonly video: HTMLVideoElement;
  /**
   * Inserts a processing stage. `output` defaults to `input` (a single node).
   * Lower `order` runs earlier. Removed automatically when the plugin stops.
   */
  insert(input: AudioNode, output?: AudioNode, order?: number): Unsubscribe;
  /** Connects the graph's final output to `node` as well (analysers, recorders). */
  tap(node: AudioNode): Unsubscribe;
}

export interface WaitForOptions {
  root?: ParentNode;
  /** Rejects after this many milliseconds; default: wait until the plugin stops. */
  timeout?: number;
}

export interface PageContext<C, Cmds extends AnyCommands> extends CommonContext<C> {
  readonly player: PagePlayer;
  readonly host: HostClient<Cmds>;
  /** Registry selector by name. */
  sel(name: SelectorName): string;
  $<E extends Element = HTMLElement>(name: SelectorName, root?: ParentNode): E | null;
  $$<E extends Element = HTMLElement>(name: SelectorName, root?: ParentNode): E[];
  /** Resolves with the first element matching the registry selector. */
  waitFor<E extends Element = HTMLElement>(name: SelectorName, options?: WaitForOptions): Promise<E>;
  /**
   * Keeps `element` in the page while the plugin runs: YTM re-renders and
   * replaces parts of it, so it is put back whenever it gets detached.
   * `place` puts it somewhere (and may do nothing while the spot isn't there yet);
   * or name a registry selector to prepend or append it to.
   */
  mount(element: Element, place: (element: Element) => void): void;
  mount(element: Element, parent: SelectorName, position?: "prepend" | "append"): void;
  /** A MutationObserver on `target` (or the element a selector names, once it exists), disconnected when the plugin stops. */
  observe(target: Node | SelectorName, options: MutationObserverInit, callback: MutationCallback): void;
  /** addEventListener that is removed automatically when the plugin stops. */
  listen<T extends EventTarget>(
    target: T,
    type: string,
    listener: (event: any) => void,
    options?: AddEventListenerOptions,
  ): void;
  /** The shared audio graph, created on first use. */
  audio(): Promise<AudioGraph>;
  /** Adds a stylesheet for the plugin's lifetime. Works at document start. */
  addStyle(css: string): StyleHandle;
  /** Shows a message in YTM's own toast (bottom left), as pear-desktop's plugins do. */
  toast(message: string): void;
  /**
   * Whether the window is on screen. The page itself can't tell: it keeps rendering,
   * and `document.hidden` stays false, while minimized or hidden. Visual loops check this to pause.
   */
  isWindowVisible(): boolean;
  /** Aborted when the plugin stops. */
  readonly signal: AbortSignal;
}

export interface StyleHandle {
  update(css: string): void;
  remove(): void;
}

export interface PagePartObject<C, Cmds extends AnyCommands> {
  /** "idle" (default) waits for DOMContentLoaded; "start" runs before YTM's scripts. */
  runAt?: "start" | "idle";
  start(ctx: PageContext<C, Cmds>): StartResult;
  /** Default: restart the page part (unless `start` registered `ctx.onConfigChange`). */
  onConfigChange?(config: Readonly<C>, ctx: PageContext<C, Cmds>): void | "restart";
}

export type PagePart<C, Cmds extends AnyCommands> =
  | ((ctx: PageContext<C, Cmds>) => StartResult)
  | PagePartObject<C, Cmds>;

// ---------------------------------------------------------------- plugin

/** A button in the plugin's settings, run by the host command of the same name. */
export interface PluginAction {
  label: string;
  description?: string;
}

export interface PluginDef<S extends ConfigShape, Cmds extends AnyCommands, Rpc extends RpcSchemas = {}> {
  id: string;
  name: string;
  description?: string;
  authors?: readonly string[];
  /** Default: all platforms. */
  platforms?: readonly Platform[];
  /** Enabled on a fresh profile; or only on these platforms. Default: false. */
  enabledByDefault?: boolean | readonly Platform[];
  /**
   * Enabling or disabling only applies after a restart (shown in settings).
   * The page part then starts only if the plugin was enabled when the page
   * loaded, and keeps running until the next load: for patches that can't be
   * undone. Config changes still apply live. Implied by `host.beforeReady`
   * and `host.windowOptions`.
   */
  restartRequired?: boolean;
  config?: S;
  /** Buttons shown in settings while the plugin is enabled; each runs `host.commands[name]`. */
  actions?: { readonly [K in keyof Cmds & string]?: PluginAction };
  host?: HostPart<ConfigOf<S>, Cmds, Rpc>;
  page?: PagePart<ConfigOf<S>, Cmds>;
  /** CSS applied while enabled; usually the result of the `css` macro. */
  style?: string | ((config: Readonly<ConfigOf<S>>) => string);
}

export type AnyPlugin = PluginDef<any, any, any>;

/** The contexts of a plugin with config schema `S`, for code split into modules. */
export type HostContextOf<S extends ConfigShape> = HostContext<ConfigOf<S>>;
export type PageContextOf<S extends ConfigShape, Cmds extends AnyCommands = {}> = PageContext<ConfigOf<S>, Cmds>;

export function definePlugin<
  const S extends ConfigShape = {},
  Cmds extends AnyCommands = {},
  Rpc extends RpcSchemas = {},
>(def: PluginDef<S, Cmds, Rpc>): PluginDef<S, Cmds, Rpc> {
  return def;
}

export function supportsPlatform(plugin: AnyPlugin, platform: string) {
  return onPlatform(plugin.platforms, platform);
}

export function isEnabledByDefault(plugin: AnyPlugin, platform: string) {
  const value = plugin.enabledByDefault;
  if (typeof value === "object") return onPlatform(value, platform);
  return value === true;
}

/** The plugin's settings buttons (`actions`), by command name. */
export function pluginActions(plugin: AnyPlugin): [name: string, action: PluginAction][] {
  const actions: Record<string, PluginAction | undefined> = plugin.actions ?? {};
  return Object.entries(actions).filter((entry): entry is [string, PluginAction] => entry[1] !== undefined);
}
