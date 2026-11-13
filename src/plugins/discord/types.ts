import { StatusDisplayType } from 'discord-api-types/v10';

import { APPLICATION_NAME } from '@/i18n';
import { config, type ConfigOf } from '@/plugins/utils/common/config';

const applicationName = { applicationName: APPLICATION_NAME };

export const discordConfig = {
  /**
   * If enabled, will try to reconnect to discord every 5 seconds after disconnecting or failing to connect
   */
  'autoReconnect': config.bool(true, {
    label: 'plugins.discord.menu.auto-reconnect',
  }),
  /**
   * If enabled, the discord rich presence gets cleared when music paused after the time specified below
   */
  'activityTimeoutEnabled': config.bool(true, {
    label: 'plugins.discord.menu.clear-activity-after-timeout',
  }),
  /**
   * The time in milliseconds after which the discord rich presence gets cleared when music paused.
   * Prompted in seconds by the plugin's own menu item.
   */
  'activityTimeoutTime': config.number(10 * 60 * 1000, { min: 0 }),
  /**
   * Add a "Play on $APPLICATION_NAME" button to rich presence
   */
  'playOnYouTubeMusic': config.bool(true, {
    label: {
      key: 'plugins.discord.menu.play-on-application',
      vars: applicationName,
    },
  }),
  /**
   * Hide the "View App On GitHub" button in the rich presence
   */
  'hideGitHubButton': config.bool(false, {
    label: 'plugins.discord.menu.hide-github-button',
  }),
  /**
   * Hide the "duration left" in the rich presence
   */
  'hideDurationLeft': config.bool(false, {
    label: 'plugins.discord.menu.hide-duration-left',
  }),
  /**
   * Controls which field is displayed in the Discord status text
   */
  'statusDisplayType': config.number(StatusDisplayType.Details, {
    label: 'plugins.discord.menu.set-status-display-type.label',
    options: [
      {
        value: StatusDisplayType.Name,
        label: {
          key: 'plugins.discord.menu.set-status-display-type.submenu.application',
          vars: applicationName,
        },
      },
      {
        value: StatusDisplayType.State,
        label: 'plugins.discord.menu.set-status-display-type.submenu.artist',
      },
      {
        value: StatusDisplayType.Details,
        label: 'plugins.discord.menu.set-status-display-type.submenu.title',
      },
    ],
  }),
};

export type DiscordPluginConfig = ConfigOf<typeof discordConfig>;
