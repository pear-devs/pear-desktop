// NOTE: vite-plugins/plugin-importer.mts imports this file at build time with
// a relative path, so it must only import types (no `@/` values).
import type {
  BackendContext,
  MenuContext,
  PreloadContext,
  RendererContext,
} from './contexts';
import type { ConfigOf, ConfigShape } from '@/plugins/utils/common/config';
import type { MenuItemConstructorOptions } from 'electron';

export type { Cleanup } from '@/loader/cleanup';

type Author = string;
type MaybePromise<T> = T | Promise<T>;

/** `{}` as a type: no config fields, no IPC. */
export type Empty = Record<never, never>;

/** What a part's start may return: nothing, or a cleanup run when the plugin stops. */
export type PartResult = MaybePromise<void | (() => unknown)>;

export enum Platform {
  Windows = 1 << 0,
  macOS = 1 << 1,
  Linux = 1 << 2,
  Freebsd = 1 << 3,
}

/**
 * A plugin's IPC between its backend (main process) and renderer, e.g.
 *
 * ```ts
 * type Ipc = {
 *   invoke: { pick(labels: string[]): number | null }; // renderer → backend, with a result
 *   toRenderer: { progress: [value: number] };         // backend → renderer
 *   toBackend: { toggle: [] };                         // renderer → backend
 * };
 * ```
 */
export interface IpcShape {
  invoke?: object;
  toRenderer?: object;
  toBackend?: object;
}

export type BackendPart<S extends ConfigShape, I extends IpcShape> = (
  ctx: BackendContext<ConfigOf<S>, I>,
) => PartResult;
export type PreloadPart<S extends ConfigShape> = (
  ctx: PreloadContext<ConfigOf<S>>,
) => PartResult;
export type RendererPart<S extends ConfigShape, I extends IpcShape> = (
  ctx: RendererContext<ConfigOf<S>, I>,
) => PartResult;

export interface PluginDef<
  S extends ConfigShape = ConfigShape,
  I extends IpcShape = IpcShape,
> {
  name: () => string;
  authors?: Author[];
  description?: () => string;
  addedVersion?: string;
  /** Platforms the plugin exists on (a `Platform` bit mask). Default: all. */
  platform?: Platform;
  /** Default: false. */
  enabledByDefault?: boolean | (() => boolean);
  /** Turning the plugin on or off asks to restart the app. */
  restartNeeded?: boolean;
  config?: S;
  /** Menu items after the ones generated from `config`. */
  menu?: (
    ctx: MenuContext<ConfigOf<S>>,
  ) => MaybePromise<MenuItemConstructorOptions[]>;
  /** CSS added to the page while the plugin runs. */
  stylesheets?: string[];

  backend?: BackendPart<S, I>;
  preload?: PreloadPart<S>;
  renderer?: RendererPart<S, I>;
}

// oxlint-disable-next-line typescript/no-explicit-any
export type AnyPluginDef = PluginDef<any, any>;
