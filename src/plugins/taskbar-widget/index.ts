import { createPlugin } from '@/utils';
import { t } from '@/i18n';
import { Platform } from '@/types/plugins';
import { screen } from 'electron';

import type { MenuContext } from '@/types/contexts';

export type TaskbarWidgetPluginConfig = {
  enabled: boolean;
  monitorIndex: number;
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
  } as TaskbarWidgetPluginConfig,

  menu: async ({
    getConfig,
    setConfig,
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
    ];
  },

  backend: {
    async start({ window: mainWindow, getConfig }) {
      const { createMiniPlayer, cleanup } = await import('./main');
      const config = await getConfig();

      await createMiniPlayer(mainWindow, config.monitorIndex);

      cleanupFn = cleanup;
    },
    stop() {
      cleanupFn?.();
      cleanupFn = null;
    },
  },
});
