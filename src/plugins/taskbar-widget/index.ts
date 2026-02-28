import { createPlugin } from '@/utils';
import { t } from '@/i18n';
import { Platform } from '@/types/plugins';
import { screen } from 'electron';

import prompt from 'custom-electron-prompt';
import promptOptions from '@/providers/prompt-options';

import type { MenuContext } from '@/types/contexts';

export type TaskbarWidgetPluginConfig = {
  enabled: boolean;
  monitorIndex: number;
  offsetX: number;
  offsetY: number;
};

let cleanupFn: (() => void) | null = null;

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
                    step: '10',
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
            setConfig({
              offsetX: Number(res[0]),
              offsetY: Number(res[1]),
            });
          }
        },
      },
    ];
  },

  backend: {
    async start({ window: mainWindow, getConfig }) {
      const { createMiniPlayer, cleanup } = await import('./main');
      const config = await getConfig();

      await createMiniPlayer(
        mainWindow,
        config.monitorIndex,
        config.offsetX,
        config.offsetY,
      );

      cleanupFn = cleanup;
    },
    stop() {
      cleanupFn?.();
      cleanupFn = null;
    },
  },
});
