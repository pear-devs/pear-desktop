import {
  type BrowserWindow,
  type IpcMain,
  type IpcRenderer,
  type WebContents,
} from 'electron';
import { type PluginConfig } from '@/types/plugins';

export interface BaseContext<Config extends PluginConfig> {
  getConfig: () => Promise<Config> | Config;
  setConfig: (conf: Partial<Omit<Config, 'enabled'>>) => Promise<void> | void;
}

export interface BackendContext<Config extends PluginConfig>
  extends BaseContext<Config> {
  ipc: {
    send: WebContents['send'];
    handle: (event: string, listener: CallableFunction) => void;
    on: (event: string, listener: CallableFunction) => void;
    removeHandler: IpcMain['removeHandler'];
  };

  window: BrowserWindow;
}

export interface MenuContext<Config extends PluginConfig>
  extends BaseContext<Config> {
  window: BrowserWindow;
  refresh: () => Promise<void> | void;
}

export interface PreloadContext<Config extends PluginConfig>
  extends BaseContext<Config> {}

export interface RendererContext<Config extends PluginConfig>
  extends BaseContext<Config> {
  ipc: {
    send: IpcRenderer['send'];
    invoke: IpcRenderer['invoke'];
    on: (event: string, listener: CallableFunction) => void;
    removeAllListeners: (event: string) => void;
  };
}
