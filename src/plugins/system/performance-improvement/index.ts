import { createPlugin } from '@/utils';
import { t } from '@/i18n';

import { injectRm3 } from './scripts/rm3';
import { injectCpuTamer } from './scripts/cpu-tamer';

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
