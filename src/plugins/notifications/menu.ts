import is from 'electron-is';

import { t } from '@/i18n';

import type { NotificationsPluginConfig } from './types';
import type { MenuTemplate } from '@/menu';
import type { MenuContext } from '@/types/contexts';

export const onMenu = (
  ctx: MenuContext<NotificationsPluginConfig>,
): MenuTemplate => {
  const { config } = ctx;
  if (!is.windows()) return [];

  return [
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
          click: (item) => ctx.setConfig({ trayControls: item.checked }),
        },
        {
          label: t(
            'plugins.notifications.menu.interactive-settings.submenu.hide-button-text',
          ),
          type: 'checkbox',
          checked: config.hideButtonText,
          click: (item) => ctx.setConfig({ hideButtonText: item.checked }),
        },
        {
          label: t(
            'plugins.notifications.menu.interactive-settings.submenu.refresh-on-play-pause',
          ),
          type: 'checkbox',
          checked: config.refreshOnPlayPause,
          click: (item) => ctx.setConfig({ refreshOnPlayPause: item.checked }),
        },
      ],
    },
  ];
};
