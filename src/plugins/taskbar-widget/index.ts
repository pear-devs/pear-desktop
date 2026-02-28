import prompt from 'custom-electron-prompt';
import { screen } from 'electron';

import { createPlugin } from '@/utils';
import { t } from '@/i18n';
import promptOptions from '@/providers/prompt-options';
import { Platform } from '@/types/plugins';

import type { MenuContext } from '@/types/contexts';

export type TaskbarWidgetPluginConfig = {
  enabled: boolean;
  monitorIndex: number;
  offsetX: number;
  offsetY: number;
  backgroundBlur: boolean;
};

let cleanupFn: (() => void) | null = null;
let updateConfigFn:
  | ((offsetX: number, offsetY: number, blurEnabled: boolean) => void)
  | null = null;

export default createPlugin({
  name: () => t('plugins.taskbar-widget.name'),
  description: () => t('plugins.taskbar-widget.description'),
  restartNeeded: true,
  platform: Platform.Windows,
  config: {
    enabled: false,
    monitorIndex: 0,
    offsetX: 0,
    offsetY: 0,
    backgroundBlur: false,
  } as TaskbarWidgetPluginConfig,

  menu: async ({
    getConfig,
    setConfig,
    window: win,
  }: MenuContext<TaskbarWidgetPluginConfig>) => {
    const config = await getConfig();
    const displays = screen.getAllDisplays();

    return [
      {
        label: t('plugins.taskbar-widget.menu.monitor.label'),
        submenu: displays.map((display, index) => ({
          label:
            index === 0
              ? `${t('plugins.taskbar-widget.menu.monitor.primary')} (${display.bounds.width}x${display.bounds.height})`
              : `${index + 1} (${display.bounds.width}x${display.bounds.height})`,
          type: 'radio' as const,
          checked: config.monitorIndex === index,
          click() {
            setConfig({ monitorIndex: index });
          },
        })),
      },
      {
        label: t('plugins.taskbar-widget.menu.position.label'),
        click: async () => {
          const res = await prompt(
            {
              title: t('plugins.taskbar-widget.menu.position.label'),
              type: 'multiInput',
              multiInputOptions: [
                {
                  label: t(
                    'plugins.taskbar-widget.menu.position.horizontal-offset',
                  ),
                  value: config.offsetX,
                  inputAttrs: {
                    type: 'number',
                    required: true,
                    step: '1',
                  },
                },
                {
                  label: t(
                    'plugins.taskbar-widget.menu.position.vertical-offset',
                  ),
                  value: config.offsetY,
                  inputAttrs: {
                    type: 'number',
                    required: true,
                    step: '1',
                  },
                },
              ],
              resizable: true,
              height: 260,
              ...promptOptions(),
            },
            win,
          ).catch(console.error);

          if (res) {
            const newOffsetX = Number(res[0]);
            const newOffsetY = Number(res[1]);
            setConfig({
              offsetX: Number.isFinite(newOffsetX) ? newOffsetX : 0,
              offsetY: Number.isFinite(newOffsetY) ? newOffsetY : 0,
            });
          }
        },
      },
      {
        label: t('plugins.taskbar-widget.menu.background-blur'),
        type: 'checkbox' as const,
        checked: config.backgroundBlur,
        click(item: Electron.MenuItem) {
          setConfig({ backgroundBlur: item.checked });
        },
      },
    ];
  },

  backend: {
    async start({ window: mainWindow, getConfig }) {
      const { createMiniPlayer, cleanup, updateConfig } =
        await import('./main');
      const config = await getConfig();

      await createMiniPlayer(
        mainWindow,
        config.monitorIndex,
        config.offsetX,
        config.offsetY,
        config.backgroundBlur,
      );

      cleanupFn = cleanup;
      updateConfigFn = updateConfig;
    },
    onConfigChange(newConfig) {
      updateConfigFn?.(
        newConfig.offsetX,
        newConfig.offsetY,
        newConfig.backgroundBlur,
      );
    },
    stop() {
      cleanupFn?.();
      cleanupFn = null;
      updateConfigFn = null;
    },
  },
});
