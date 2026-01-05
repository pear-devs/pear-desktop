import { dialog } from 'electron';
import prompt from 'custom-electron-prompt';
import { deepmerge } from 'deepmerge-ts';

import { downloadPlaylist } from './main';
import { getFolder } from './main/utils';
import { DefaultPresetList } from './types';

import { t } from '@/i18n';

import promptOptions from '@/providers/prompt-options';

import { type DownloaderPluginConfig, defaultConfig } from './index';

import type { MenuContext } from '@/types/contexts';
import type { MenuTemplate } from '@/menu';

export const onMenu = async ({
  getConfig,
  setConfig,
}: MenuContext<DownloaderPluginConfig>): Promise<MenuTemplate> => {
  const config = await getConfig();
  const _engineKey = 'plugins.downloader.menu.engine.label';
  const engineTranslated = t(_engineKey);
  const engineLabel =
    typeof engineTranslated === 'string' && !engineTranslated.includes(_engineKey)
      ? engineTranslated
      : 'Download Method';
  const _ytdlpKey = 'plugins.downloader.menu.engine.ytdlp-path';
  const ytdlpTranslated = t(_ytdlpKey);
  const ytdlpLabel =
    typeof ytdlpTranslated === 'string' && !ytdlpTranslated.includes(_ytdlpKey)
      ? ytdlpTranslated
      : 'Path of yt-dlp';
  const _ffmpegKey = 'plugins.downloader.menu.engine.ffmpeg-path';
  const ffmpegTranslated = t(_ffmpegKey);
  const ffmpegLabel =
    typeof ffmpegTranslated === 'string' && !ffmpegTranslated.includes(_ffmpegKey)
      ? ffmpegTranslated
      : 'Path of ffmpeg';

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
          checked: config.downloadOnFinish?.enabled ?? false,
          click(item) {
            setConfig({
              downloadOnFinish: {
                ...deepmerge(
                  defaultConfig.downloadOnFinish,
                  config.downloadOnFinish,
                ),
                enabled: item.checked,
              },
            });
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
                config.downloadOnFinish?.folder ?? config.downloadFolder,
              ),
            });
            if (result) {
              setConfig({
                downloadOnFinish: {
                  ...deepmerge(
                    defaultConfig.downloadOnFinish,
                    config.downloadOnFinish,
                  ),
                  folder: result[0],
                },
              });
            }
          },
        },
        {
          label: t(
            'plugins.downloader.menu.download-finish-settings.submenu.mode',
          ),
          type: 'submenu',
          submenu: [
            {
              label: t(
                'plugins.downloader.menu.download-finish-settings.submenu.seconds',
              ),
              type: 'radio',
              checked: config.downloadOnFinish?.mode === 'seconds',
              click() {
                setConfig({
                  downloadOnFinish: {
                    ...deepmerge(
                      defaultConfig.downloadOnFinish,
                      config.downloadOnFinish,
                    ),
                    mode: 'seconds',
                  },
                });
              },
            },
            {
              label: t(
                'plugins.downloader.menu.download-finish-settings.submenu.percent',
              ),
              type: 'radio',
              checked: config.downloadOnFinish?.mode === 'percent',
              click() {
                setConfig({
                  downloadOnFinish: {
                    ...deepmerge(
                      defaultConfig.downloadOnFinish,
                      config.downloadOnFinish,
                    ),
                    mode: 'percent',
                  },
                });
              },
            },
          ],
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
                  value:
                    config.downloadOnFinish?.seconds ??
                    defaultConfig.downloadOnFinish!.seconds,
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
                  value:
                    config.downloadOnFinish?.percent ??
                    defaultConfig.downloadOnFinish!.percent,
                },
              ],
              ...promptOptions(),
              height: 240,
              resizable: true,
            }).catch(console.error);

            if (!res) {
              return undefined;
            }

            setConfig({
              downloadOnFinish: {
                ...deepmerge(
                  defaultConfig.downloadOnFinish,
                  config.downloadOnFinish,
                ),
                seconds: Number(res[0]),
                percent: Number(res[1]),
              },
            });
            return;
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
      label: engineLabel,
      type: 'submenu',
      submenu: [
        {
          label: 'youtube.js',
          type: 'radio',
          checked: (config.engine ?? defaultConfig.engine) !== 'yt-dlp',
          click() {
            setConfig({ engine: 'youtube.js' });
          },
        },
        {
          label: 'yt-dlp',
          type: 'radio',
          checked: (config.engine ?? defaultConfig.engine) === 'yt-dlp',
          click() {
            setConfig({ engine: 'yt-dlp' });
          },
        },
        {
          type: 'separator',
        },
        {
          label: ytdlpLabel,
          click() {
            const result = dialog.showOpenDialogSync({
              properties: ['openFile'],
              defaultPath: config.ytdlpPath ?? defaultConfig.ytdlpPath,
            });
            if (result && result[0]) {
              setConfig({ ytdlpPath: result[0] });
            }
          },
        },
        {
          label: ffmpegLabel,
          click() {
            const result = dialog.showOpenDialogSync({
              properties: ['openFile'],
              defaultPath: config.ytdlpFfmpegPath ?? '',
            });
            if (result && result[0]) {
              setConfig({ ytdlpFfmpegPath: result[0] });
            }
          },
        },
      ],
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
