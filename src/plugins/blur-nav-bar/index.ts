import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import style from './style.css?inline';

export default createPlugin({
  name: () => t('plugins.blur-nav-bar.name'),
  description: () => t('plugins.blur-nav-bar.description'),
  restartNeeded: false,
  renderer: (ctx) => {
    ctx.addStyle(style);
  },
});
