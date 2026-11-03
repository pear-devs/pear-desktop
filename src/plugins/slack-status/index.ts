import { t } from '@/i18n';
import { createPlugin } from '@/utils';
import { backend } from './main';
import { onMenu } from './menu';

export type SlackStatusConfig = {
  enabled: boolean;
  token: string;
  activityTimeoutEnabled?: boolean;
  activityTimeoutTime?: number;
};

export default createPlugin({
  name: () => t('plugins.slack-status.name'),
  description: () => t('plugins.slack-status.description'),
  restartNeeded: true,
  config: {
    enabled: false,
    token: '',
    activityTimeoutEnabled: true,
    activityTimeoutTime: 10 * 60 * 1000,
  } as SlackStatusConfig,
  menu: onMenu,
  backend,
});
