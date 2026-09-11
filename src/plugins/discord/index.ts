import { StatusDisplayType } from 'discord-api-types/v10';

import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { backend } from './main';
import { onMenu } from './menu';

export type DiscordPluginConfig = {
  'enabled': boolean;
  /**
   * If enabled, will try to reconnect to discord every 5 seconds after disconnecting or failing to connect
   *
   * @default true
   */
  'autoReconnect': boolean;
  /**
   * If enabled, the discord rich presence gets cleared when music paused after the time specified below
   */
  'activityTimeoutEnabled': boolean;
  /**
   * The time in milliseconds after which the discord rich presence gets cleared when music paused
   *
   * @default 10 * 60 * 1000 (10 minutes)
   */
  'activityTimeoutTime': number;
  /**
   * Add a "Play on $APPLICATION_NAME" button to rich presence
   */
  'playOn\u0059\u006f\u0075\u0054\u0075\u0062\u0065\u004d\u0075\u0073\u0069\u0063': boolean;
  /**
   * Hide the "View App On GitHub" button in the rich presence
   */
  'hideGitHubButton': boolean;
  /**
   * Hide the "duration left" in the rich presence
   */
  'hideDurationLeft': boolean;
  /**
   * Controls which field is displayed in the Discord status text
   */
  'statusDisplayType': (typeof StatusDisplayType)[keyof typeof StatusDisplayType];
};

export default createPlugin({
  name: () => t('plugins.discord.name'),
  description: () => t('plugins.discord.description'),
  restartNeeded: false,
  config: {
    'enabled': false,
    'autoReconnect': true,
    'activityTimeoutEnabled': true,
    'activityTimeoutTime': 10 * 60 * 1000,
    'playOn\u0059\u006f\u0075\u0054\u0075\u0062\u0065\u004d\u0075\u0073\u0069\u0063': true,
    'hideGitHubButton': false,
    'hideDurationLeft': false,
    'statusDisplayType': StatusDisplayType.Details,
  } as DiscordPluginConfig,
  settings: [
    {
      type: 'switch',
      key: 'autoReconnect',
      label: () => t('plugins.discord.settings.auto-reconnect'),
    },
    {
      type: 'switch',
      key: 'activityTimeoutEnabled',
      label: () => t('plugins.discord.settings.activity-timeout-enabled'),
    },
    {
      type: 'slider',
      key: 'activityTimeoutTime',
      label: () => t('plugins.discord.settings.activity-timeout-time'),
      min: 1,
      max: 60,
      unit: 'min',
      scale: 60 * 1000,
    },
    {
      type: 'switch',
      key: 'hideGitHubButton',
      label: () => t('plugins.discord.settings.hide-github-button'),
    },
    {
      type: 'switch',
      key: 'hideDurationLeft',
      label: () => t('plugins.discord.settings.hide-duration-left'),
    },
  ],
  menu: onMenu,
  backend,
});
