import { createPlugin } from '@/utils';
import { t } from '@/i18n';
import { Platform } from '@/types/plugins';

let cleanupFn: (() => void) | null = null;

export default createPlugin({
  name: () => t('plugins.taskbar-widget.name'),
  description: () => t('plugins.taskbar-widget.description'),
  restartNeeded: true,
  platform: Platform.Windows,
  config: {
    enabled: false,
  },

  backend: {
    async start({ window: mainWindow }) {
      const { createMiniPlayer, cleanup } = await import('./main');

      await createMiniPlayer(mainWindow);

      cleanupFn = cleanup;
    },
    stop() {
      cleanupFn?.();
      cleanupFn = null;
    },
  },
});
