import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { injectCpuTamer } from './scripts/cpu-tamer';
import { injectRm3 } from './scripts/rm3';

export default createPlugin({
  name: () => t('plugins.performance-improvement.name'),
  description: () => t('plugins.performance-improvement.description'),
  restartNeeded: true,
  addedVersion: '3.9.X',
  config: {
    enabled: true,
  },
  renderer() {
    injectRm3();
    injectCpuTamer();
  },
});
