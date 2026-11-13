import { dialog } from 'electron';

import { t } from '@/i18n';

import type { APIServerConfig } from './config';
import type { MenuTemplate } from '@/menu';
import type { MenuContext } from '@/types/contexts';

export const onMenu = (ctx: MenuContext<APIServerConfig>): MenuTemplate => {
  const { config, window } = ctx;
  const setConfig: typeof ctx.setConfig = (patch) => ctx.setConfig(patch);
  return [
    {
      label: t('plugins.api-server.menu.https.label'),
      type: 'submenu',
      submenu: [
        {
          label: t('plugins.api-server.menu.https.submenu.enable-https.label'),
          type: 'checkbox',
          checked: config.useHttps,
          click(menuItem) {
            setConfig({ useHttps: menuItem.checked });
          },
        },
        {
          label: t('plugins.api-server.menu.https.submenu.cert.label'),
          type: 'normal',
          async click() {
            const result = await dialog.showOpenDialog(window, {
              title: t(
                'plugins.api-server.menu.https.submenu.cert.dialogTitle',
              ),
              filters: [{ name: 'Certificate', extensions: ['crt', 'pem'] }],
              properties: ['openFile'],
            });
            if (!result.canceled && result.filePaths.length > 0) {
              setConfig({ certPath: result.filePaths[0] });
            }
          },
        },
        {
          label: t('plugins.api-server.menu.https.submenu.key.label'),
          type: 'normal',
          async click() {
            const result = await dialog.showOpenDialog(window, {
              title: t('plugins.api-server.menu.https.submenu.key.dialogTitle'),
              filters: [{ name: 'Private Key', extensions: ['key', 'pem'] }],
              properties: ['openFile'],
            });
            if (!result.canceled && result.filePaths.length > 0) {
              setConfig({ keyPath: result.filePaths[0] });
            }
          },
        },
      ],
    },
  ];
};
