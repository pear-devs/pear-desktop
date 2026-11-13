import { t } from '@/i18n';
import { config } from '@/plugins/utils/common/config';
import { createPlugin } from '@/utils';

import renderer from './renderer';

export const skipSilencesConfig = {
  // No menu item for it (there is no label for it yet)
  onlySkipBeginning: config.bool(false),
};

export default createPlugin({
  name: () => t('plugins.skip-silences.name'),
  description: () => t('plugins.skip-silences.description'),
  restartNeeded: true,
  config: skipSilencesConfig,
  renderer,
});
