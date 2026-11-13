import { config, type ConfigOf } from '@/plugins/utils/common/config';
import { Platform } from '@/types/plugins';

export const ToastStyles = {
  logo: 1,
  banner_centered_top: 2,
  hero: 3,
  banner_top_custom: 4,
  banner_centered_bottom: 5,
  banner_bottom: 6,
  legacy: 7,
};

export const snakeToCamel = (string_: string) =>
  string_.replaceAll(/([-_][a-z]|^[a-z])/g, (group) =>
    group.toUpperCase().replace('-', ' ').replace('_', ' '),
  );

export const notificationsConfig = {
  /**
   * Has effect only on Linux
   */
  urgency: config.select(
    'normal',
    [
      { value: 'low', label: { text: 'Low' } },
      { value: 'normal', label: { text: 'Normal' } },
      { value: 'critical', label: { text: 'High' } },
    ],
    { label: 'plugins.notifications.menu.priority', platforms: Platform.Linux },
  ),
  /**
   * the following has effect only on Windows
   */
  interactive: config.bool(true, {
    label: 'plugins.notifications.menu.interactive',
    platforms: Platform.Windows,
  }),
  /**
   * See plugins/notifications/types for more info
   */
  toastStyle: config.number(ToastStyles.logo, {
    label: 'plugins.notifications.menu.toast-style',
    platforms: Platform.Windows,
    options: Object.entries(ToastStyles)
      .sort(([, a], [, b]) => a - b)
      .map(([name, value]) => ({
        value,
        label: { text: snakeToCamel(name) },
      })),
  }),
  unpauseNotification: config.bool(false, {
    label: 'plugins.notifications.menu.unpause-notification',
  }),
  // Interactive settings: shown in a submenu by the plugin's own menu (Windows)
  refreshOnPlayPause: config.bool(false),
  trayControls: config.bool(true),
  hideButtonText: config.bool(false),
};

export type NotificationsPluginConfig = ConfigOf<typeof notificationsConfig>;
