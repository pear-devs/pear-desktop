import { APPLICATION_NAME, t } from '@/i18n';
import { createPlugin } from '@/utils';

import backend from './back';
import renderer from './renderer';
import { captionsSelectorConfig } from './types';

export default createPlugin({
  name: () => t('plugins.captions-selector.name'),
  description: () =>
    t('plugins.captions-selector.description', {
      applicationName: APPLICATION_NAME,
    }),
  config: captionsSelectorConfig,
  backend,
  renderer,
});
