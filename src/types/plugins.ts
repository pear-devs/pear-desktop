import type { MusicPlayer } from '@/types/music-player';

import type {
  BackendContext,
  MenuContext,
  PreloadContext,
  RendererContext,
} from './contexts';

type Author = string;

export type PluginConfig = {
  enabled: boolean;
};

export type PluginLifecycleSimple<Context, This> = (
  this: This,
  ctx: Context,
) => void | Promise<void>;
export type PluginLifecycleExtra<Config, Context, This> = This & {
  start?: PluginLifecycleSimple<Context, This>;
  stop?: PluginLifecycleSimple<Context, This>;
  onConfigChange?: (this: This, newConfig: Config) => void | Promise<void>;
};
export type RendererPluginLifecycleExtra<Config, Context, This> = This &
  PluginLifecycleExtra<Config, Context, This> & {
    onPlayerApiReady?: (
      this: This,
      playerApi: MusicPlayer,
      context: Context,
    ) => void | Promise<void>;
  };

export type PluginLifecycle<Config, Context, This> =
  | PluginLifecycleSimple<Context, This>
  | PluginLifecycleExtra<Config, Context, This>;
export type RendererPluginLifecycle<Config, Context, This> =
  | PluginLifecycleSimple<Context, This>
  | RendererPluginLifecycleExtra<Config, Context, This>;

export enum Platform {
  Windows = 1 << 0,
  macOS = 1 << 1,
  Linux = 1 << 2,
  Freebsd = 1 << 3,
}

export interface PluginDef<
  BackendProperties,
  PreloadProperties,
  RendererProperties,
  Config extends PluginConfig = PluginConfig,
> {
  name: () => string;
  authors?: Author[];
  description?: () => string;
  addedVersion?: string;
  config?: Config;
  platform?: Platform;

  menu?: (
    ctx: MenuContext<Config>,
  ) =>
    | Promise<Electron.MenuItemConstructorOptions[]>
    | Electron.MenuItemConstructorOptions[];
  stylesheets?: string[];
  restartNeeded?: boolean;

  backend?: {
    [Key in keyof BackendProperties]: BackendProperties[Key];
  } & PluginLifecycle<Config, BackendContext<Config>, BackendProperties>;
  preload?: {
    [Key in keyof PreloadProperties]: PreloadProperties[Key];
  } & PluginLifecycle<Config, PreloadContext<Config>, PreloadProperties>;
  renderer?: {
    [Key in keyof RendererProperties]: RendererProperties[Key];
  } & RendererPluginLifecycle<
    Config,
    RendererContext<Config>,
    RendererProperties
  >;
}
