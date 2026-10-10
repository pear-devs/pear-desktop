import {
  contextBridge,
  ipcRenderer,
  type IpcRendererEvent,
  webFrame,
} from 'electron';
import is from 'electron-is';

import { loadI18n, setLanguage } from '@/i18n';

import * as config from './config';
import {
  forceLoadPreloadPlugin,
  forceUnloadPreloadPlugin,
  loadAllPreloadPlugins,
} from './loader/preload';

const rendererConfigKeys = new Set([
  'options.startingPage',
  'options.removeUpgradeButton',
  'options.likeButtons',
  'options.swapLikeButtonsOrder',
  'options.language',
  'options.hideMenu',
  'plugins.transparent-player.opacity',
]);

const isValidVideoToggleOptions = (
  options: unknown,
): options is Record<string, unknown> => {
  if (
    options === null ||
    typeof options !== 'object' ||
    Object.getPrototypeOf(options) !== Object.prototype
  )
    return false;

  return Reflect.ownKeys(options).every((key) => {
    if (typeof key !== 'string') return false;

    const descriptor = Object.getOwnPropertyDescriptor(options, key);
    if (!descriptor || !('value' in descriptor)) return false;

    switch (key) {
      case 'enabled':
      case 'hideVideo':
      case 'forceHide':
        return typeof descriptor.value === 'boolean';
      case 'mode':
        return (
          typeof descriptor.value === 'string' &&
          ['custom', 'native', 'disabled'].includes(descriptor.value)
        );
      case 'align':
        return (
          typeof descriptor.value === 'string' &&
          ['left', 'middle', 'right'].includes(descriptor.value)
        );
      default:
        return false;
    }
  });
};

const rendererConfig = {
  get: (key: string) =>
    rendererConfigKeys.has(key) ? config.get(key as never) : undefined,
  plugins: {
    getPlugins: () =>
      Object.fromEntries(
        Object.entries(config.plugins.getPlugins()).map(([id, plugin]) => [
          id,
          { enabled: plugin.enabled },
        ]),
      ),
    isEnabled: (plugin: string) => config.plugins.isEnabled(plugin),
    setOptions: (plugin: string, options: object) => {
      if (plugin === 'video-toggle' && isValidVideoToggleOptions(options)) {
        config.plugins.setOptions(plugin, options);
      }
    },
  },
};

// @ts-expect-error dummy
globalThis.customElements = { define() {} };

new MutationObserver((mutations, observer) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      const elem = node as HTMLElement;
      if (elem.tagName !== 'SCRIPT') continue;

      const script = elem as HTMLScriptElement;
      if (
        !script.getAttribute('src')?.endsWith('custom-elements-es5-adapter.js')
      )
        continue;

      script.remove();

      observer.disconnect();
      return;
    }
  }
}).observe(document, { subtree: true, childList: true });

loadI18n().then(async () => {
  await setLanguage(config.get('options.language') ?? 'en');
  await loadAllPreloadPlugins();
});

ipcRenderer.on('plugin:unload', async (_, id: string) => {
  await forceUnloadPreloadPlugin(id);
});
ipcRenderer.on('plugin:enable', async (_, id: string) => {
  await forceLoadPreloadPlugin(id);
});

contextBridge.exposeInMainWorld('mainConfig', rendererConfig);
contextBridge.exposeInMainWorld('electronIs', is);
contextBridge.exposeInMainWorld('ipcRenderer', {
  subscribe: (channel: string, listener: (...args: unknown[]) => void) => {
    const wrapped = (_event: IpcRendererEvent, ...args: unknown[]) =>
      listener(...args);
    ipcRenderer.on(channel, wrapped);
    // Keep exact listener identity on the preload side of contextBridge.
    return () => {
      ipcRenderer.removeListener(channel, wrapped);
    };
  },
  on: (
    channel: string,
    listener: (event: IpcRendererEvent, ...args: unknown[]) => void,
  ) => ipcRenderer.on(channel, listener),
  off: (channel: string, listener: (...args: unknown[]) => void) =>
    ipcRenderer.off(channel, listener),
  once: (
    channel: string,
    listener: (event: IpcRendererEvent, ...args: unknown[]) => void,
  ) => ipcRenderer.once(channel, listener),
  send: (channel: string, ...args: unknown[]) =>
    ipcRenderer.send(channel, ...args),
  removeListener: (channel: string, listener: (...args: unknown[]) => void) =>
    ipcRenderer.removeListener(channel, listener),
  removeAllListeners: (channel: string) =>
    ipcRenderer.removeAllListeners(channel),
  invoke: async (channel: string, ...args: unknown[]): Promise<unknown> =>
    ipcRenderer.invoke(channel, ...args),
  sendSync: (channel: string, ...args: unknown[]): unknown =>
    ipcRenderer.sendSync(channel, ...args),
  sendToHost: (channel: string, ...args: unknown[]) =>
    ipcRenderer.sendToHost(channel, ...args),
});
contextBridge.exposeInMainWorld('reload', () =>
  ipcRenderer.send('peard:reload'),
);
contextBridge.exposeInMainWorld(
  'ELECTRON_RENDERER_URL',
  process.env.ELECTRON_RENDERER_URL,
);

const [path, script] = ipcRenderer.sendSync('get-renderer-script') as [
  string | null,
  string,
];
let blocked = true;
if (path) {
  webFrame.executeJavaScriptInIsolatedWorld(
    0,
    [
      {
        code: script,
        url: path,
      },
    ],
    true,
    () => (blocked = false),
  );
} else {
  webFrame.executeJavaScript(script, true, () => (blocked = false));
}

// HACK: Wait for the script to be executed
while (blocked);
