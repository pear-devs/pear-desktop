import { dialog } from 'electron';

import { downloadPlaylist } from './main';
import { defaultMenuDownloadLabel, getFolder } from './main/utils';
import { DefaultPresetList } from './types';

import type { MenuContext } from '@/types/contexts';
import type { MenuTemplate } from '@/menu';

import type { DownloaderPluginConfig } from './index';
import { t } from '@/i18n';

export const onMenu = async ({
  getConfig,
  setConfig,
}: MenuContext<DownloaderPluginConfig>): Promise<MenuTemplate> => {
  const config = await getConfig();

  return [
    {
      label: defaultMenuDownloadLabel,
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
    {
      label: t('plugins.downloader.menu.presets'),
      submenu: Object.keys(DefaultPresetList).map((preset) => ({
        label: preset,
        type: 'radio',
        checked: config.selectedPreset === preset,
        click() {
          setConfig({ selectedPreset: preset });
        },
      })),
    },
    {
      label: t('plugins.downloader.menu.skip-existing'),
      type: 'checkbox',
      checked: config.skipExisting,
      click(item) {
        setConfig({ skipExisting: item.checked });
      },
    },
  ];
};
