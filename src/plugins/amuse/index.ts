import { APPLICATION_NAME, t } from '@/i18n';
import { createPlugin } from '@/utils';

import backend from './backend';

export default createPlugin({
  name: () => t('plugins.amuse.name'),
  description: () =>
    t('plugins.amuse.description', {
      applicationName: APPLICATION_NAME,
    }),
  addedVersion: '3.7.X',
  restartNeeded: true,
  backend,
});
