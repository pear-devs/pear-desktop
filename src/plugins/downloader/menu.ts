import prompt from 'custom-electron-prompt';
import { dialog } from 'electron';

import { t } from '@/i18n';
import promptOptions from '@/providers/prompt-options';

import { downloadPlaylist } from './main';
import { getFolder } from './main/utils';

import type { downloaderConfig } from './config';
import type { MenuTemplate } from '@/menu';
import type { ConfigOf } from '@/plugins/utils/common/config';
import type { MenuContext } from '@/types/contexts';

export const onMenu = (
  ctx: MenuContext<ConfigOf<typeof downloaderConfig>>,
): MenuTemplate => {
  const { config } = ctx;
  const setConfig: typeof ctx.setConfig = (patch) => ctx.setConfig(patch);
  return [
    {
      label: t('plugins.downloader.menu.download-finish-settings.label'),
      type: 'submenu',
      submenu: [
        {
          label: t(
            'plugins.downloader.menu.download-finish-settings.submenu.enabled',
          ),
          type: 'checkbox',
          checked: config.downloadOnFinish.enabled,
          click(item) {
            setConfig({ downloadOnFinish: { enabled: item.checked } });
          },
        },
        {
          type: 'separator',
        },
        {
          label: t('plugins.downloader.menu.choose-download-folder'),
          click() {
            const result = dialog.showOpenDialogSync({
              properties: ['openDirectory', 'createDirectory'],
              defaultPath: getFolder(
                config.downloadOnFinish.folder ?? config.downloadFolder,
              ),
            });
            if (result) {
              setConfig({ downloadOnFinish: { folder: result[0] } });
            }
          },
        },
        {
          label: t(
            'plugins.downloader.menu.download-finish-settings.submenu.mode',
          ),
          type: 'submenu',
          submenu: (['seconds', 'percent'] as const).map((mode) => ({
            label: t(
              `plugins.downloader.menu.download-finish-settings.submenu.${mode}`,
            ),
            type: 'radio' as const,
            checked: config.downloadOnFinish.mode === mode,
            click() {
              setConfig({ downloadOnFinish: { mode } });
            },
          })),
        },
        {
          label: t(
            'plugins.downloader.menu.download-finish-settings.submenu.advanced',
          ),
          async click() {
            const res = await prompt({
              title: t(
                'plugins.downloader.menu.download-finish-settings.prompt.title',
              ),
              type: 'multiInput',
              multiInputOptions: [
                {
                  label: t(
                    'plugins.downloader.menu.download-finish-settings.prompt.last-seconds',
                  ),
                  inputAttrs: {
                    type: 'number',
                    required: true,
                    min: '0',
                    step: '1',
                  },
                  value: config.downloadOnFinish.seconds,
                },
                {
                  label: t(
                    'plugins.downloader.menu.download-finish-settings.prompt.last-percent',
                  ),
                  inputAttrs: {
                    type: 'number',
                    required: true,
                    min: '1',
                    max: '100',
                    step: '1',
                  },
                  value: config.downloadOnFinish.percent,
                },
              ],
              ...promptOptions(),
              height: 240,
              resizable: true,
            }).catch(console.error);

            if (!res) {
              return;
            }

            setConfig({
              downloadOnFinish: {
                seconds: Number(res[0]),
                percent: Number(res[1]),
              },
            });
          },
        },
      ],
    },
    {
      label: t('plugins.downloader.menu.download-playlist'),
      click: () => downloadPlaylist(),
    },
    {
      label: t('plugins.downloader.menu.choose-download-folder'),
      click() {
        const result = dialog.showOpenDialogSync({
          properties: ['openDirectory', 'createDirectory'],
          defaultPath: getFolder(config.downloadFolder ?? ''),
        });
        if (result) {
          setConfig({ downloadFolder: result[0] });
        } // Else = user pressed cancel
      },
    },
  ];
};
