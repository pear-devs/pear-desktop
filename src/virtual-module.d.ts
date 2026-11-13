declare module 'virtual:plugins' {
  import type { AnyPluginDef } from '@/types/plugins';

  export const mainPlugins: () => Promise<Record<string, AnyPluginDef>>;
  export const preloadPlugins: () => Promise<Record<string, AnyPluginDef>>;
  export const rendererPlugins: () => Promise<Record<string, AnyPluginDef>>;

  /** Every plugin's metadata, config schema and (in main) menu. */
  export const allPlugins: () => Promise<
    Record<string, Omit<AnyPluginDef, 'backend' | 'preload' | 'renderer'>>
  >;
}

declare module 'virtual:i18n' {
  import type { LanguageResources } from '@/i18n/resources/@types';

  export const languageResources: () => Promise<LanguageResources>;
}
