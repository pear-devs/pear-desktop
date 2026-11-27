import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { startSfwMusic } from './renderer';

export default createPlugin<unknown, unknown, { cleanup?: () => void }>({
  name: () => t('plugins.sfw-music.name'),
  description: () => t('plugins.sfw-music.description'),
  restartNeeded: false,
  config: { enabled: false },
  renderer: {
    onPlayerApiReady(api) {
      this.cleanup?.();
      this.cleanup = startSfwMusic(api);
    },
    stop() {
      this.cleanup?.();
      this.cleanup = undefined;
    },
  },
});
