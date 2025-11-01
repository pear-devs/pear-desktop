import is from 'electron-is';
import { type MenuItem } from 'electron';

import { snakeToCamel, ToastStyles, urgencyLevels } from './utils';

import { t } from '@/i18n';

import type { NotificationsPluginConfig } from './index';

import type { MenuTemplate } from '@/menu';
import type { MenuContext } from '@/types/contexts';

export const onMenu = async ({
  getConfig,
  setConfig,
}: MenuContext<NotificationsPluginConfig>): Promise<MenuTemplate> => {
  const config = await getConfig();

  const getToastStyleMenuItems = (options: NotificationsPluginConfig) => {
    const array = Array.from({ length: Object.keys(ToastStyles).length });

    // ToastStyles index starts from 1
    for (const [name, index] of Object.entries(ToastStyles)) {
      array[index - 1] = {
        label: snakeToCamel(name),
        type: 'radio',
        checked: options.toastStyle === index,
        click: () => setConfig({ toastStyle: index }),
      } satisfies Electron.MenuItemConstructorOptions;
    }

    return array as Electron.MenuItemConstructorOptions[];
  };

  const getMenu = (): MenuTemplate => {
    if (is.linux()) {
      return [
        {
          label: t('plugins.notifications.menu.priority'),
          submenu: urgencyLevels.map((level) => ({
            label: level.name,
            type: 'radio',
            checked: config.urgency === level.value,
            click: () => setConfig({ urgency: level.value }),
          })),
        },
      ];
    } else if (is.windows()) {
      return [
        {
          label: t('plugins.notifications.menu.interactive'),
          type: 'checkbox',
          checked: config.interactive,
          // Doesn't update until restart
          click: (item: MenuItem) => setConfig({ interactive: item.checked }),
        },
        {
          // Submenu with settings for interactive notifications (name shouldn't be too long)
          label: t('plugins.notifications.menu.interactive-settings.label'),
          submenu: [
            {
              label: t(
                'plugins.notifications.menu.interactive-settings.submenu.tray-controls',
              ),
              type: 'checkbox',
              checked: config.trayControls,
              click: (item: MenuItem) =>
                setConfig({ trayControls: item.checked }),
            },
            {
              label: t(
                'plugins.notifications.menu.interactive-settings.submenu.hide-button-text',
              ),
              type: 'checkbox',
              checked: config.hideButtonText,
              click: (item: MenuItem) =>
                setConfig({ hideButtonText: item.checked }),
            },
            {
              label: t(
                'plugins.notifications.menu.interactive-settings.submenu.refresh-on-play-pause',
              ),
              type: 'checkbox',
              checked: config.refreshOnPlayPause,
              click: (item: MenuItem) =>
                setConfig({ refreshOnPlayPause: item.checked }),
            },
          ],
        },
        {
          label: t('plugins.notifications.menu.toast-style'),
          submenu: getToastStyleMenuItems(config),
        },
      ];
    } else {
      return [];
    }
  };

  return [
    ...getMenu(),
    {
      label: t('plugins.notifications.menu.unpause-notification'),
      type: 'checkbox',
      checked: config.unpauseNotification,
      click: (item) => setConfig({ unpauseNotification: item.checked }),
    },
  ];
};
