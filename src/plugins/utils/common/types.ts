import type { BrowserWindow } from 'electron';

export interface Config {
  enabled: boolean;
}

export interface Plugin<ConfigType extends Config> {
  name: string;
  description: string;
  config: ConfigType;
}

export interface RendererPlugin<
  ConfigType extends Config,
> extends Plugin<ConfigType> {
  onEnable: (config: ConfigType) => void;
}

export interface MainPlugin<
  ConfigType extends Config,
> extends Plugin<ConfigType> {
  onEnable: (window: BrowserWindow, config: ConfigType) => string;
}

export interface PreloadPlugin<
  ConfigType extends Config,
> extends Plugin<ConfigType> {
  onEnable: (config: ConfigType) => void;
}

export interface MenuPlugin<
  ConfigType extends Config,
> extends Plugin<ConfigType> {
  onEnable: (config: ConfigType) => void;
}

const defaultPluginConfig: Record<string, unknown> = {};
export const definePluginConfig = <T>(id: string, defaultValue: T): T => {
  defaultPluginConfig[id] = defaultValue;

  return defaultValue;
};
