import { createPlugin } from '@/utils';
import { t } from '@/i18n';

import { backend } from './backend';
import { renderer } from './renderer';
import { menu } from './menu';

export default createPlugin({
  name: () => t('plugins.lyrics-provider.name'),
  description: () => t('plugins.lyrics-provider.description'),
  restartNeeded: false,
  config: {
    enabled: true,
    preferredProvider: null as string | null,
  },

  backend,
  renderer,
  menu,
});