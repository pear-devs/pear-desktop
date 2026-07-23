import { t } from '@/i18n';
import { Platform } from '@/types/plugins';
import { createPlugin } from '@/utils';

import { onConfigChange, onMainLoad } from './main';
import { onMenu } from './menu';

export interface NotificationsPluginConfig {
  enabled: boolean;
  unpauseNotification: boolean;
  /**
   * Has effect only on Linux
   */
  urgency: 'low' | 'normal' | 'critical';
  /**
   * the following has effect only on Windows
   */
  interactive: boolean;
  /**
   * See plugins/notifications/utils for more info
   */
  toastStyle: number;
  refreshOnPlayPause: boolean;
  trayControls: boolean;
  hideButtonText: boolean;
}

export const defaultConfig: NotificationsPluginConfig = {
  enabled: false,
  unpauseNotification: false,
  urgency: 'normal',
  interactive: true,
  toastStyle: 1,
  refreshOnPlayPause: false,
  trayControls: true,
  hideButtonText: false,
};

export default createPlugin({
  name: () => t('plugins.notifications.name'),
  description: () => t('plugins.notifications.description'),
  restartNeeded: true,
  config: defaultConfig,
  settings: [
    {
      type: 'switch',
      key: 'unpauseNotification',
      label: () => t('plugins.notifications.menu.unpause-notification'),
    },
    {
      type: 'select',
      key: 'urgency',
      label: () => t('plugins.notifications.menu.priority'),
      platform: Platform.Linux,
      options: [
        { value: 'low', label: () => 'Low' },
        { value: 'normal', label: () => 'Normal' },
        { value: 'critical', label: () => 'High' },
      ],
    },
    {
      type: 'switch',
      key: 'interactive',
      label: () => t('plugins.notifications.menu.interactive'),
      platform: Platform.Windows,
      restartNeeded: true,
    },
    {
      type: 'switch',
      key: 'trayControls',
      label: () =>
        t(
          'plugins.notifications.menu.interactive-settings.submenu.tray-controls',
        ),
      platform: Platform.Windows,
    },
    {
      type: 'switch',
      key: 'hideButtonText',
      label: () =>
        t(
          'plugins.notifications.menu.interactive-settings.submenu.hide-button-text',
        ),
      platform: Platform.Windows,
    },
    {
      type: 'switch',
      key: 'refreshOnPlayPause',
      label: () =>
        t(
          'plugins.notifications.menu.interactive-settings.submenu.refresh-on-play-pause',
        ),
      platform: Platform.Windows,
    },
    {
      type: 'select',
      variant: 'dropdown',
      key: 'toastStyle',
      label: () => t('plugins.notifications.menu.toast-style'),
      platform: Platform.Windows,
      options: [
        { value: 1, label: () => 'Logo' },
        { value: 2, label: () => 'Banner Centered Top' },
        { value: 3, label: () => 'Hero' },
        { value: 4, label: () => 'Banner Top Custom' },
        { value: 5, label: () => 'Banner Centered Bottom' },
        { value: 6, label: () => 'Banner Bottom' },
        { value: 7, label: () => 'Legacy' },
      ],
    },
  ],
  menu: onMenu,
  backend: {
    start: onMainLoad,
    onConfigChange,
  },
});
