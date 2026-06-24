import { createPlugin } from '@/utils';
import { onMenu } from './menu';
import { backend, type SlackNowPlayingConfig } from './main';
import { t } from '@/i18n';

export default createPlugin({
  name: () => t('plugins.slack-now-playing.name'),
  description: () => t('plugins.slack-now-playing.description'),
  restartNeeded: true,
  config: {
    enabled: false,
    token: '',
    cookieToken: '',
    emojiName: 'my-album-art',
  } as SlackNowPlayingConfig,
  menu: onMenu,
  backend,
});
