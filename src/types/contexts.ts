import type { Empty, IpcShape } from './plugins';
import type { Cleanup } from '@/loader/cleanup';
import type { DeepPartial } from '@/plugins/utils/common/config';
import type { SongInfoCallback } from '@/providers/song-info';
import type { MusicPlayer } from '@/types/music-player';
import type { BrowserWindow } from 'electron';

// oxlint-disable typescript/no-explicit-any

type MaybePromise<T> = T | Promise<T>;
type Timer = ReturnType<typeof setTimeout>;

export interface Logger {
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/** Node-style event emitters: Electron's app, windows, webContents, nativeTheme… */
export interface NodeEmitter {
  on(...args: any[]): unknown;
  removeListener(...args: any[]): unknown;
}

export interface Listen {
  <K extends keyof WindowEventMap>(
    target: Window,
    type: K,
    listener: (event: WindowEventMap[K]) => void,
    options?: AddEventListenerOptions | boolean,
  ): void;
  <K extends keyof DocumentEventMap>(
    target: Document,
    type: K,
    listener: (event: DocumentEventMap[K]) => void,
    options?: AddEventListenerOptions | boolean,
  ): void;
  <K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    listener: (event: HTMLElementEventMap[K]) => void,
    options?: AddEventListenerOptions | boolean,
  ): void;
  (
    target: EventTarget,
    type: string,
    listener: (event: any) => void,
    options?: AddEventListenerOptions | boolean,
  ): void;
  (
    target: NodeEmitter,
    event: string,
    listener: (...args: any[]) => void,
  ): void;
}

/** What every part of a running plugin gets, in every process. */
export interface BaseContext<C> {
  readonly id: string;
  /** The current config. */
  readonly config: Readonly<C>;
  /** Saves a partial config. `ctx.config` reflects it at once. */
  setConfig(patch: DeepPartial<C>): Promise<void>;
  /**
   * Called when the config is changed elsewhere (menu, other process).
   * Registering one replaces the default, which is restarting this part.
   */
  onConfigChange(
    listener: (config: Readonly<C>, previous: Readonly<C>) => unknown,
  ): void;
  /** Runs when the plugin stops (disabled, restarted or app quit). */
  onCleanup(fn: Cleanup): void;
  /** Aborted when the plugin stops. */
  readonly signal: AbortSignal;
  /** Timers cleared when the plugin stops. */
  setTimeout(fn: () => void, ms?: number): Timer;
  setInterval(fn: () => void, ms?: number): Timer;
  clearTimeout(timer: Timer | undefined): void;
  clearInterval(timer: Timer | undefined): void;
  /** Adds a listener that is removed when the plugin stops. */
  listen: Listen;
  readonly log: Logger;
}

// ---------------------------------------------------------------- IPC types

type Section<I, K extends keyof IpcShape> = I extends { [P in K]: infer M }
  ? M
  : Empty;
type Invokes<I> = Section<I, 'invoke'>;
type ToRenderer<I> = Section<I, 'toRenderer'>;
type ToBackend<I> = Section<I, 'toBackend'>;
type Args<T> = T extends (...args: infer A) => unknown
  ? A
  : T extends unknown[]
    ? T
    : never;
type Result<T> = T extends (...args: any[]) => infer R ? Awaited<R> : never;

/** The core's `peard:*` channels, outside the plugin's own namespace. */
export interface CoreIpcMain {
  on(channel: string, listener: (...args: any[]) => void): void;
  once(channel: string, listener: (...args: any[]) => void): void;
  handle(channel: string, handler: (...args: any[]) => unknown): void;
  send(channel: string, ...args: unknown[]): void;
}

export interface CoreIpcRenderer {
  on(channel: string, listener: (...args: any[]) => void): void;
  once(channel: string, listener: (...args: any[]) => void): void;
  send(channel: string, ...args: unknown[]): void;
  invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T>;
}

export interface BackendIpc<I> {
  /** Answers `ctx.ipc.invoke(name, …)` from the renderer. */
  handle<K extends keyof Invokes<I> & string>(
    name: K,
    handler: (
      ...args: Args<Invokes<I>[K]>
    ) => MaybePromise<Result<Invokes<I>[K]>>,
  ): void;
  /** Sends to the renderer's `ctx.ipc.on(name, …)`. */
  send<K extends keyof ToRenderer<I> & string>(
    name: K,
    ...args: Args<ToRenderer<I>[K]>
  ): void;
  /** Receives the renderer's `ctx.ipc.send(name, …)`. */
  on<K extends keyof ToBackend<I> & string>(
    name: K,
    listener: (...args: Args<ToBackend<I>[K]>) => void,
  ): void;
  readonly core: CoreIpcMain;
}

export interface RendererIpc<I> {
  /** Calls the backend's `ctx.ipc.handle(name, …)`. */
  invoke<K extends keyof Invokes<I> & string>(
    name: K,
    ...args: Args<Invokes<I>[K]>
  ): Promise<Result<Invokes<I>[K]>>;
  /** Sends to the backend's `ctx.ipc.on(name, …)`. */
  send<K extends keyof ToBackend<I> & string>(
    name: K,
    ...args: Args<ToBackend<I>[K]>
  ): void;
  /** Receives the backend's `ctx.ipc.send(name, …)`. */
  on<K extends keyof ToRenderer<I> & string>(
    name: K,
    listener: (...args: Args<ToRenderer<I>[K]>) => void,
  ): void;
  readonly core: CoreIpcRenderer;
}

// ---------------------------------------------------------------- contexts

export interface BackendContext<C, I = Empty> extends BaseContext<C> {
  readonly window: BrowserWindow;
  readonly ipc: BackendIpc<I>;
  /** Called on song info changes, until the plugin stops. */
  onSongInfo(callback: SongInfoCallback): void;
}

export type PreloadContext<C> = BaseContext<C>;

export interface StyleHandle {
  update(css: string): void;
  remove(): void;
}

export interface RendererContext<C, I = Empty> extends BaseContext<C> {
  readonly ipc: RendererIpc<I>;
  /** A MutationObserver, disconnected when the plugin stops. */
  observe(
    target: Node,
    options: MutationObserverInit,
    callback: MutationCallback,
  ): MutationObserver;
  /** Adds a stylesheet to the page, removed when the plugin stops. */
  addStyle(css: string): StyleHandle;
  /**
   * Called with the player API once it is ready (at once if it already is),
   * unless the plugin stopped before.
   */
  onPlayerApiReady(callback: (api: MusicPlayer) => unknown): void;
}

export interface MenuContext<C> {
  readonly id: string;
  readonly config: Readonly<C>;
  setConfig(patch: DeepPartial<C>): Promise<void>;
  readonly window: BrowserWindow;
  /** Rebuilds the menu. */
  refresh(): Promise<void> | void;
}
