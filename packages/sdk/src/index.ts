// @pear/sdk: everything a plugin needs. A plugin is one file exporting
// `definePlugin({...})`; the build splits it into a host (main process) part
// and a page (YTM main world) part, like #[cfg] in Rust.

import type { App, BrowserWindow, BrowserWindowConstructorOptions, Session, WebRequest } from "electron";
import type { ConfigOf, ConfigShape } from "./config.ts";
import type { NowPlaying, PlayerAction, Track, PlaybackStatus, Unsubscribe, YTPlayerApi } from "./player.ts";
import type { SelectorName } from "./selectors.ts";

export * from "./config.ts";
export * from "./player.ts";
export type { SelectorName } from "./selectors.ts";

export type Platform = "linux" | "win32" | "darwin";
export type Cleanup = () => void;
type MaybePromise<T> = T | Promise<T>;

export interface Logger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

type AnyCommands = Record<string, (...args: any[]) => unknown>;

// ---------------------------------------------------------------- host side

export interface HostPlayer {
  readonly state: NowPlaying;
  on(event: "change", listener: (state: NowPlaying, previous: NowPlaying) => void): Unsubscribe;
  on(event: "trackChange", listener: (track: Track | null, state: NowPlaying) => void): Unsubscribe;
  control(action: PlayerAction): void;
}

export interface HostContext<C> {
  readonly id: string;
  /** Always the current config. */
  readonly config: Readonly<C>;
  setConfig(patch: Partial<C>): void;
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
  /** Sends an event to this plugin's page part (`ctx.host.on`). */
  emit(event: string, payload?: unknown): void;
  /** Runs when the plugin stops (disabled, restarted or app quit). */
  onCleanup(fn: Cleanup): void;
  readonly log: Logger;
}

export interface BeforeReadyContext<C> {
  readonly config: Readonly<C>;
  readonly app: App;
  /** Chromium features; collected from all plugins and applied once. */
  enableFeatures(...features: string[]): void;
  disableFeatures(...features: string[]): void;
}

export interface HostPart<C, Cmds extends AnyCommands> {
  /** Runs before `app.whenReady()` when enabled at launch (command-line switches). Changes need a restart. */
  beforeReady?(ctx: BeforeReadyContext<C>): void;
  start?(ctx: HostContext<C>): MaybePromise<void | Cleanup>;
  /** Default: restart the host part. */
  onConfigChange?(config: Readonly<C>, ctx: HostContext<C>): void | "restart";
  /** Options merged into the main window's constructor when enabled at launch (frame, transparency…). */
  windowOptions?(config: Readonly<C>): BrowserWindowConstructorOptions;
  /** Typed commands the page part can call with `ctx.host.invoke`. `this` is the host context. */
  commands?: Cmds & ThisType<HostContext<C>>;
}

// ---------------------------------------------------------------- page side

export interface PagePlayer {
  /** YTM's player API once available. */
  readonly api: YTPlayerApi | null;
  ready(): Promise<YTPlayerApi>;
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
  invoke<K extends keyof Cmds & string>(
    name: K,
    ...args: Parameters<Cmds[K]>
  ): Promise<Awaited<ReturnType<Cmds[K]>>>;
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

export interface PageContext<C, Cmds extends AnyCommands> {
  readonly id: string;
  readonly config: Readonly<C>;
  setConfig(patch: Partial<C>): void;
  readonly player: PagePlayer;
  readonly host: HostClient<Cmds>;
  /** Registry selector by name. */
  sel(name: SelectorName): string;
  $<E extends Element = HTMLElement>(name: SelectorName, root?: ParentNode): E | null;
  $$<E extends Element = HTMLElement>(name: SelectorName, root?: ParentNode): E[];
  /** Resolves with the first element matching the registry selector. */
  waitFor<E extends Element = HTMLElement>(name: SelectorName, options?: WaitForOptions): Promise<E>;
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
  onCleanup(fn: Cleanup): void;
  /** Aborted when the plugin stops. */
  readonly signal: AbortSignal;
  readonly log: Logger;
}

export interface StyleHandle {
  update(css: string): void;
  remove(): void;
}

export interface PagePartObject<C, Cmds extends AnyCommands> {
  /** "idle" (default) waits for DOMContentLoaded; "start" runs before YTM's scripts. */
  runAt?: "start" | "idle";
  start(ctx: PageContext<C, Cmds>): MaybePromise<void | Cleanup>;
  /** Default: restart the page part. */
  onConfigChange?(config: Readonly<C>, ctx: PageContext<C, Cmds>): void | "restart";
}

export type PagePart<C, Cmds extends AnyCommands> =
  | ((ctx: PageContext<C, Cmds>) => MaybePromise<void | Cleanup>)
  | PagePartObject<C, Cmds>;

// ---------------------------------------------------------------- plugin

export interface PluginDef<S extends ConfigShape, Cmds extends AnyCommands> {
  id: string;
  name: string;
  description?: string;
  authors?: readonly string[];
  /** Default: all platforms. */
  platforms?: readonly Platform[];
  enabledByDefault?: boolean;
  config?: S;
  host?: HostPart<ConfigOf<S>, Cmds>;
  page?: PagePart<ConfigOf<S>, Cmds>;
  /** CSS applied while enabled; usually the result of the `css` macro. */
  style?: string | ((config: Readonly<ConfigOf<S>>) => string);
}

export type AnyPlugin = PluginDef<any, any>;

export function definePlugin<const S extends ConfigShape = {}, Cmds extends AnyCommands = {}>(
  def: PluginDef<S, Cmds>,
): PluginDef<S, Cmds> {
  return def;
}

export function supportsPlatform(plugin: AnyPlugin, platform: string) {
  return !plugin.platforms || (plugin.platforms as readonly string[]).includes(platform);
}
