//mport { t } from '@/i18n';
import { createPlugin } from '@/utils';
import { renderer } from './renderer';

export default createPlugin({
  name: () => 'Audio only mode',
  description: () =>
    'Automatically prefers official album audio over YouTube videos.',
  restartNeeded: false,
  config: {
    enabled: false,
  },

  renderer,
});