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
        unloadAdblockerEngine(this.mainWindow.webContents.session);
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

      contextBridge.exposeInMainWorld('_pruner', (o: Record<string, unknown>) => {
        delete o.playerAds;
        delete o.adPlacements;
        delete o.adSlots;
        if (o.playerResponse as Record<string, unknown> | undefined) {
          delete (o.playerResponse as Record<string, unknown>).playerAds;
          delete (o.playerResponse as Record<string, unknown>).adPlacements;
          delete (o.playerResponse as Record<string, unknown>).adSlots;
        }
        if (o.ytInitialPlayerResponse as Record<string, unknown> | undefined) {
          delete (o.ytInitialPlayerResponse as Record<string, unknown>).playerAds;
          delete (o.ytInitialPlayerResponse as Record<string, unknown>).adPlacements;
          delete (o.ytInitialPlayerResponse as Record<string, unknown>).adSlots;
        }
        return o;
      });

      webFrame.executeJavaScript(script);
    },
  },
});
