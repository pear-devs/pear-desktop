import { BrowserWindow, ipcMain } from 'electron';
 
import { t } from '@/i18n';
 
import { providerNames } from './providers';
 
import type {
  SyncedLyricsPluginConfig,
  TranslationProvider,
} from './types';
import type { MenuContext } from '@/types/contexts';
import type { MenuItemConstructorOptions } from 'electron';
 
const promptForApiKey = (
  ctx: MenuContext<SyncedLyricsPluginConfig>,
  currentValue: string | undefined,
): Promise<string | null> => {
  return new Promise((resolve) => {
    const promptWindow = new BrowserWindow({
      width: 420,
      height: 160,
      parent: ctx.window,
      modal: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
    });
 
    const title = t('plugins.synced-lyrics.menu.api-key-prompt.title');
    const label = t('plugins.synced-lyrics.menu.api-key-prompt.label');
    const safeValue = (currentValue ?? '').replace(/"/g, '&quot;');
 
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>${title}</title>
          <style>
            body {
              font-family: system-ui, sans-serif;
              background: #1e1e1e;
              color: #eee;
              margin: 0;
              padding: 16px;
            }
            label { display: block; margin-bottom: 8px; font-size: 13px; }
            input {
              width: 100%;
              box-sizing: border-box;
              padding: 8px;
              font-size: 14px;
              margin-bottom: 16px;
              border-radius: 4px;
              border: 1px solid #444;
              background: #2a2a2a;
              color: #eee;
            }
            .buttons { display: flex; justify-content: flex-end; gap: 8px; }
            button {
              padding: 6px 14px;
              border-radius: 4px;
              border: none;
              cursor: pointer;
              font-size: 13px;
            }
            .ok { background: #3ea6ff; color: #000; }
            .cancel { background: #333; color: #eee; }
          </style>
        </head>
        <body>
          <label for="apiKeyInput">${label}</label>
          <input id="apiKeyInput" type="text" value="${safeValue}" autofocus />
          <div class="buttons">
            <button class="cancel" id="cancelBtn">Cancel</button>
            <button class="ok" id="okBtn">OK</button>
          </div>
          <script>
            const { ipcRenderer } = require('electron');
            const input = document.getElementById('apiKeyInput');
            input.focus();
            input.select();
 
            document.getElementById('okBtn').addEventListener('click', () => {
              ipcRenderer.send('synced-lyrics:api-key-result', input.value);
            });
            document.getElementById('cancelBtn').addEventListener('click', () => {
              ipcRenderer.send('synced-lyrics:api-key-result', null);
            });
            input.addEventListener('keydown', (e) => {
              if (e.key === 'Enter') {
                ipcRenderer.send('synced-lyrics:api-key-result', input.value);
              }
              if (e.key === 'Escape') {
                ipcRenderer.send('synced-lyrics:api-key-result', null);
              }
            });
          </script>
        </body>
      </html>
    `;
 
    promptWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
 
    const handleResult = (_event: Electron.IpcMainEvent, value: string | null) => {
      ipcMain.removeListener('synced-lyrics:api-key-result', handleResult);
      resolve(value && value.trim() ? value.trim() : null);
      if (!promptWindow.isDestroyed()) promptWindow.close();
    };
 
    ipcMain.on('synced-lyrics:api-key-result', handleResult);
 
    promptWindow.on('closed', () => {
      ipcMain.removeListener('synced-lyrics:api-key-result', handleResult);
      resolve(null);
    });
  });
};
 
export const menu = async (
  ctx: MenuContext<SyncedLyricsPluginConfig>,
): Promise<MenuItemConstructorOptions[]> => {
  const config = await ctx.getConfig();
 
  return [
    {
      label: t('plugins.synced-lyrics.menu.preferred-provider.label'),
      toolTip: t('plugins.synced-lyrics.menu.preferred-provider.tooltip'),
      type: 'submenu',
      submenu: [
        {
          label: t('plugins.synced-lyrics.menu.preferred-provider.none.label'),
          toolTip: t(
            'plugins.synced-lyrics.menu.preferred-provider.none.tooltip',
          ),
          type: 'radio',
          checked: config.preferredProvider === undefined,
          click() {
            ctx.setConfig({ preferredProvider: undefined });
          },
        },
        ...providerNames.map(
          (provider) =>
            ({
              label: provider,
              type: 'radio',
              checked: config.preferredProvider === provider,
              click() {
                ctx.setConfig({ preferredProvider: provider });
              },
            }) as const,
        ),
      ],
    },
    {
      label: t('plugins.synced-lyrics.menu.precise-timing.label'),
      toolTip: t('plugins.synced-lyrics.menu.precise-timing.tooltip'),
      type: 'checkbox',
      checked: config.preciseTiming,
      click(item) {
        ctx.setConfig({
          preciseTiming: item.checked,
        });
      },
    },
    {
      label: t('plugins.synced-lyrics.menu.line-effect.label'),
      toolTip: t('plugins.synced-lyrics.menu.line-effect.tooltip'),
      type: 'submenu',
      submenu: [
        {
          label: t(
            'plugins.synced-lyrics.menu.line-effect.submenu.fancy.label',
          ),
          toolTip: t(
            'plugins.synced-lyrics.menu.line-effect.submenu.fancy.tooltip',
          ),
          type: 'radio',
          checked: config.lineEffect === 'fancy',
          click() {
            ctx.setConfig({
              lineEffect: 'fancy',
            });
          },
        },
        {
          label: t(
            'plugins.synced-lyrics.menu.line-effect.submenu.scale.label',
          ),
          toolTip: t(
            'plugins.synced-lyrics.menu.line-effect.submenu.scale.tooltip',
          ),
          type: 'radio',
          checked: config.lineEffect === 'scale',
          click() {
            ctx.setConfig({
              lineEffect: 'scale',
            });
          },
        },
        {
          label: t(
            'plugins.synced-lyrics.menu.line-effect.submenu.offset.label',
          ),
          toolTip: t(
            'plugins.synced-lyrics.menu.line-effect.submenu.offset.tooltip',
          ),
          type: 'radio',
          checked: config.lineEffect === 'offset',
          click() {
            ctx.setConfig({
              lineEffect: 'offset',
            });
          },
        },
        {
          label: t(
            'plugins.synced-lyrics.menu.line-effect.submenu.focus.label',
          ),
          toolTip: t(
            'plugins.synced-lyrics.menu.line-effect.submenu.focus.tooltip',
          ),
          type: 'radio',
          checked: config.lineEffect === 'focus',
          click() {
            ctx.setConfig({
              lineEffect: 'focus',
            });
          },
        },
      ],
    },
    {
      label: t('plugins.synced-lyrics.menu.default-text-string.label'),
      toolTip: t('plugins.synced-lyrics.menu.default-text-string.tooltip'),
      type: 'submenu',
      submenu: [
        { label: '♪', value: '♪' },
        { label: '" "', value: ' ' },
        { label: '...', value: ['.', '..', '...'] },
        { label: '•••', value: ['•', '••', '•••'] },
        { label: '———', value: '———' },
      ].map(({ label, value }) => ({
        label,
        type: 'radio',
        checked:
          typeof value === 'string'
            ? config.defaultTextString === value
            : JSON.stringify(config.defaultTextString) ===
              JSON.stringify(value),
        click() {
          ctx.setConfig({ defaultTextString: value });
        },
      })),
    },
    {
      label: t('plugins.synced-lyrics.menu.romanization.label'),
      toolTip: t('plugins.synced-lyrics.menu.romanization.tooltip'),
      type: 'checkbox',
      checked: config.romanization,
      click(item) {
        ctx.setConfig({
          romanization: item.checked,
        });
      },
    },
    {
      label: t('plugins.synced-lyrics.menu.convert-chinese-character.label'),
      toolTip: t(
        'plugins.synced-lyrics.menu.convert-chinese-character.tooltip',
      ),
      type: 'submenu',
      submenu: [
        {
          label: t(
            'plugins.synced-lyrics.menu.convert-chinese-character.submenu.disabled.label',
          ),
          toolTip: t(
            'plugins.synced-lyrics.menu.convert-chinese-character.submenu.disabled.tooltip',
          ),
          type: 'radio',
          checked:
            config.convertChineseCharacter === 'disabled' ||
            config.convertChineseCharacter === undefined,
          click() {
            ctx.setConfig({
              convertChineseCharacter: 'disabled',
            });
          },
        },
        {
          label: t(
            'plugins.synced-lyrics.menu.convert-chinese-character.submenu.simplified-to-traditional.label',
          ),
          toolTip: t(
            'plugins.synced-lyrics.menu.convert-chinese-character.submenu.simplified-to-traditional.tooltip',
          ),
          type: 'radio',
          checked: config.convertChineseCharacter === 'simplifiedToTraditional',
          click() {
            ctx.setConfig({
              convertChineseCharacter: 'simplifiedToTraditional',
            });
          },
        },
        {
          label: t(
            'plugins.synced-lyrics.menu.convert-chinese-character.submenu.traditional-to-simplified.label',
          ),
          toolTip: t(
            'plugins.synced-lyrics.menu.convert-chinese-character.submenu.traditional-to-simplified.tooltip',
          ),
          type: 'radio',
          checked: config.convertChineseCharacter === 'traditionalToSimplified',
          click() {
            ctx.setConfig({
              convertChineseCharacter: 'traditionalToSimplified',
            });
          },
        },
      ],
    },
    {
      label: t('plugins.synced-lyrics.menu.show-time-codes.label'),
      toolTip: t('plugins.synced-lyrics.menu.show-time-codes.tooltip'),
      type: 'checkbox',
      checked: config.showTimeCodes,
      click(item) {
        ctx.setConfig({
          showTimeCodes: item.checked,
        });
      },
    },
    {
      label: t('plugins.synced-lyrics.menu.show-lyrics-even-if-inexact.label'),
      toolTip: t(
        'plugins.synced-lyrics.menu.show-lyrics-even-if-inexact.tooltip',
      ),
      type: 'checkbox',
      checked: config.showLyricsEvenIfInexact,
      click(item) {
        ctx.setConfig({
          showLyricsEvenIfInexact: item.checked,
        });
      },
    },
    {
      label: t('plugins.synced-lyrics.menu.show-translation.label'),
      toolTip: t('plugins.synced-lyrics.menu.show-translation.tooltip'),
      type: 'checkbox',
      checked: config.translationEnabled,
      click(item) {
        ctx.setConfig({
          translationEnabled: item.checked,
        });
      },
    },
    {
      label: t('plugins.synced-lyrics.menu.translation-language.label'),
      toolTip: t('plugins.synced-lyrics.menu.translation-language.tooltip'),
      type: 'submenu',
      submenu: ['es', 'en', 'fr', 'de', 'ja', 'ko'].map((lang) => ({
        label: lang,
        type: 'radio',
        checked: config.translationTargetLang === lang,
        click() {
          ctx.setConfig({ translationTargetLang: lang });
        },
      })),
    },
    {
      label: t('plugins.synced-lyrics.menu.translation-provider.label'),
      toolTip: t('plugins.synced-lyrics.menu.translation-provider.tooltip'),
      type: 'submenu',
      submenu: [
        {
          label: t(
            'plugins.synced-lyrics.menu.translation-provider.google-gtx',
          ),
          type: 'radio',
          checked:
            (config.translationProvider ?? 'google-gtx') === 'google-gtx',
          click() {
            ctx.setConfig({ translationProvider: 'google-gtx' });
          },
        },
        {
          label: t(
            'plugins.synced-lyrics.menu.translation-provider.google-cloud',
          ),
          type: 'radio',
          checked: config.translationProvider === 'google-cloud',
          async click() {
            const key = await promptForApiKey(ctx, config.googleCloudApiKey);
            if (!key) return;
            ctx.setConfig({
              translationProvider: 'google-cloud' as TranslationProvider,
              googleCloudApiKey: key,
            });
          },
        },
        {
          label: t(
            'plugins.synced-lyrics.menu.translation-provider.libretranslate',
          ),
          type: 'radio',
          checked: config.translationProvider === 'libretranslate',
          async click() {
            const key = await promptForApiKey(
              ctx,
              config.libretranslateApiKey,
            );
            if (!key) return;
            ctx.setConfig({
              translationProvider: 'libretranslate' as TranslationProvider,
              libretranslateApiKey: key,
            });
          },
        },
      ],
    },
  ];
};
