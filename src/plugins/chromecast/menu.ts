import { getCastController } from './backend/controller';
import { type ChromecastPluginConfig } from './types';

import { t } from '@/i18n';

import type { MenuContext } from '@/types/contexts';
import type { MenuTemplate } from '@/menu';

// Kept in its own file (not inline in index.ts) so the renderer build drops the
// whole `getCastController` -> backend chain when the menu property is stripped.
export const menu = async ({
  getConfig,
  setConfig,
  refresh,
}: MenuContext<ChromecastPluginConfig>): Promise<MenuTemplate> => {
  const config = await getConfig();
  const castController = getCastController();
  const devices = castController.listDevices();
  const activeId = castController.activeDeviceId;

  const deviceItems: MenuTemplate =
    devices.length === 0
      ? [
          {
            label: t('plugins.chromecast.menu.no-devices'),
            enabled: false,
          },
        ]
      : devices.map((device) => ({
          label: device.model
            ? `${device.name} (${device.model})`
            : device.name,
          type: 'radio' as const,
          checked: device.id === activeId,
          async click() {
            if (device.id === activeId) {
              castController.disconnect();
            } else {
              await castController.connectTo(device.id);
            }
            await refresh();
          },
        }));

  return [
    {
      label: t('plugins.chromecast.menu.devices'),
      submenu: deviceItems,
    },
    {
      label: t('plugins.chromecast.menu.stop-casting'),
      enabled: !!activeId,
      async click() {
        castController.disconnect();
        await refresh();
      },
    },
    {
      label: t('plugins.chromecast.menu.refresh-devices'),
      click() {
        castController.refreshDevices();
        setTimeout(() => {
          Promise.resolve(refresh()).catch(console.error);
        }, 1500);
      },
    },
    { type: 'separator' },
    {
      label: t('plugins.chromecast.menu.mute-local'),
      type: 'checkbox',
      checked: config.muteLocalWhenCasting,
      click(item) {
        setConfig({ muteLocalWhenCasting: item.checked });
      },
    },
    {
      label: t('plugins.chromecast.menu.auto-connect'),
      type: 'checkbox',
      checked: config.autoConnect,
      click(item) {
        setConfig({ autoConnect: item.checked });
      },
    },
  ];
};
