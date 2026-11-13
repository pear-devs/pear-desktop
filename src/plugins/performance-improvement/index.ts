import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { injectCpuTamer } from './scripts/cpu-tamer';
import { injectRm3 } from './scripts/rm3';

// The scripts patch page globals for good: they can't be undone, so turning
// the plugin off needs a restart (`restartNeeded`), and turning it back on
// before that mustn't inject them a second time.
let injected = false;

export default createPlugin({
  name: () => t('plugins.performance-improvement.name'),
  description: () => t('plugins.performance-improvement.description'),
  restartNeeded: true,
  addedVersion: '3.9.X',
  enabledByDefault: true,
  renderer: () => {
    if (injected) return;
    injected = true;
    injectRm3();
    injectCpuTamer();
  },
});
