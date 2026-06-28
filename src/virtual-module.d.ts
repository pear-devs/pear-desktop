declare module 'virtual:plugins' {
  import type { PluginConfig, PluginDef } from '@/types/plugins';

  type Plugin = PluginDef<unknown, unknown, unknown, PluginConfig>;

  export const mainPlugins: () => Promise<Record<string, Plugin>>;
  export const preloadPlugins: () => Promise<Record<string, Plugin>>;
  export const rendererPlugins: () => Promise<Record<string, Plugin>>;

  export const allPlugins: () => Promise<
    Record<string, Omit<Plugin, 'backend' | 'preload' | 'renderer'>>
  >;
}

declare module 'virtual:i18n' {
  import type { LanguageResources } from '@/i18n/resources/@types';

  export const languageResources: () => Promise<LanguageResources>;
}
