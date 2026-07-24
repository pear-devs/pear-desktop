import prompt from 'custom-electron-prompt';
import { contextBridge, webFrame, type BrowserWindow } from 'electron';

import { t } from '@/i18n';
import promptOptions from '@/providers/prompt-options';
import { createPlugin } from '@/utils';

import { loadAdblockerEngine, unloadAdblockerEngine } from './blocker';

export interface AdBlockConfig {
  enabled: boolean;
  additionalBlockLists: string[];
}

export default createPlugin<
  {
    mainWindow: BrowserWindow | null;
  },
  unknown,
  unknown,
  AdBlockConfig
>({
  name: () => t('plugins.adblock.name'),
  description: () => t('plugins.adblock.description'),
  restartNeeded: false,
  config: {
    enabled: true,
    additionalBlockLists: [],
  } as AdBlockConfig,
  menu: ({ getConfig, setConfig, window }) => {
    const promptAdditionalLists = async () => {
      const config = await getConfig();
      const res = await prompt(
        {
          title: t('plugins.adblock.menu.additional-lists'),
          value: config.additionalBlockLists.join(', '),
          type: 'input',
          ...promptOptions(),
        },
        window,
      );
      if (typeof res === 'string') {
        setConfig({
          additionalBlockLists: res
            .split(',')
            .map((s: string) => s.trim())
            .filter(Boolean),
        });
      }
    };

    return [
      {
        label: t('plugins.adblock.menu.additional-lists'),
        click: promptAdditionalLists,
      },
    ];
  },
  backend: {
    mainWindow: null,
    async start({ getConfig, window }) {
      const config = await getConfig();
      this.mainWindow = window;

      await loadAdblockerEngine(
        window.webContents.session,
        config.additionalBlockLists,
      );
    },
    stop({ window }) {
      unloadAdblockerEngine(window.webContents.session);
    },
    async onConfigChange(newConfig) {
      if (this.mainWindow) {
        await loadAdblockerEngine(
          this.mainWindow.webContents.session,
          newConfig.additionalBlockLists,
        );
      }
    },
  },
  preload: {
    start() {
      const script = `const _prunerFn = window._pruner;
    window._pruner = undefined;
    JSON.parse = new Proxy(JSON.parse, {
      apply() {
        return _prunerFn(Reflect.apply(...arguments));
      },
    });
    Response.prototype.json = new Proxy(Response.prototype.json, {
      apply() {
        return Reflect.apply(...arguments).then((o) => _prunerFn(o));
      },
    }); 0`;

      contextBridge.exposeInMainWorld('_pruner', (o: unknown) => {
        if (o === null || typeof o !== 'object') return o;
        const payload = o as Record<string, unknown>;
        delete payload.playerAds;
        delete payload.adPlacements;
        delete payload.adSlots;
        if (payload.playerResponse as Record<string, unknown> | undefined) {
          delete (payload.playerResponse as Record<string, unknown>).playerAds;
          delete (payload.playerResponse as Record<string, unknown>).adPlacements;
          delete (payload.playerResponse as Record<string, unknown>).adSlots;
        }
        if (payload.ytInitialPlayerResponse as Record<string, unknown> | undefined) {
          delete (payload.ytInitialPlayerResponse as Record<string, unknown>).playerAds;
          delete (payload.ytInitialPlayerResponse as Record<string, unknown>).adPlacements;
          delete (payload.ytInitialPlayerResponse as Record<string, unknown>).adSlots;
        }
        return payload;
      });

      webFrame.executeJavaScript(script);
    },
  },
});
