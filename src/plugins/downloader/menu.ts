import prompt from 'custom-electron-prompt';
import { deepmerge } from 'deepmerge-ts';
import { dialog } from 'electron';

import { t } from '@/i18n';
import promptOptions from '@/providers/prompt-options';

import { type DownloaderPluginConfig, defaultConfig } from './index';
import { downloadPlaylist } from './main';
import { getFolder } from './main/utils';
import { DefaultPresetList } from './types';

import type { MenuTemplate } from '@/menu';
import type { MenuContext } from '@/types/contexts';

/** Keeps a prompt result inside sane bounds, falling back to the old value */
const toWholeNumber = (
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;

  return Math.min(Math.max(Math.round(parsed), min), max);
};

/** Builds the plugin's menu entries */
export const onMenu = async ({
  getConfig,
  setConfig,
}: MenuContext<DownloaderPluginConfig>): Promise<MenuTemplate> => {
  const config = await getConfig();
  const onFinish = deepmerge(
    defaultConfig.downloadOnFinish,
    config.downloadOnFinish,
  );

  const finishSettingsKey = (key: string) =>
    `plugins.downloader.menu.download-finish-settings.${key}`;

  return [
    {
      label: t(finishSettingsKey('label')),
      type: 'submenu',
      submenu: [
        {
          label: t(finishSettingsKey('submenu.enabled')),
          type: 'checkbox',
          checked: onFinish.enabled,
          click(item) {
            setConfig({
              downloadOnFinish: { ...onFinish, enabled: item.checked },
            });
          },
        },
        {
          type: 'separator',
        },
        {
          label: t(finishSettingsKey('submenu.settings')),
          async click() {
            const res = await prompt({
              title: t(finishSettingsKey('prompt.title')),
              label: t(finishSettingsKey('prompt.description')),
              type: 'multiInput',
              multiInputOptions: [
                {
                  label: t(finishSettingsKey('prompt.mode')),
                  value: onFinish.mode,
                  selectOptions: {
                    seconds: t(finishSettingsKey('prompt.mode-seconds')),
                    percent: t(finishSettingsKey('prompt.mode-percent')),
                  },
                },
                {
                  label: t(finishSettingsKey('prompt.last-seconds')),
                  value: onFinish.seconds,
                  inputAttrs: {
                    type: 'number',
                    required: true,
                    min: '0',
                    step: '1',
                  },
                },
                {
                  label: t(finishSettingsKey('prompt.last-percent')),
                  value: onFinish.percent,
                  inputAttrs: {
                    type: 'number',
                    required: true,
                    min: '1',
                    max: '100',
                    step: '1',
                  },
                },
                {
                  label: t(finishSettingsKey('prompt.folder')),
                  value: onFinish.folder ?? '',
                  inputAttrs: {
                    type: 'text',
                    placeholder: getFolder(config.downloadFolder),
                  },
                },
              ],
              ...promptOptions(),
              width: 540,
              height: 460,
              resizable: true,
            }).catch(console.error);

            if (!res) {
              return;
            }

            const [mode, seconds, percent, folder] = res;
            setConfig({
              downloadOnFinish: {
                ...onFinish,
                mode: mode === 'percent' ? 'percent' : 'seconds',
                seconds: toWholeNumber(seconds, onFinish.seconds, 0, 3600),
                percent: toWholeNumber(percent, onFinish.percent, 1, 100),
                folder: folder?.trim() || undefined,
              },
            });
          },
        },
        {
          label: t(finishSettingsKey('submenu.choose-folder')),
          click() {
            const result = dialog.showOpenDialogSync({
              properties: ['openDirectory', 'createDirectory'],
              defaultPath: getFolder(onFinish.folder ?? config.downloadFolder),
            });
            if (result) {
              setConfig({
                downloadOnFinish: { ...onFinish, folder: result[0] },
              });
            }
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
          defaultPath: getFolder(config.downloadFolder),
        });
        if (result) {
          setConfig({ downloadFolder: result[0] });
        } // Else = user pressed cancel
      },
    },
    {
      label: t('plugins.downloader.menu.presets'),
      submenu: [
        ...Object.keys(DefaultPresetList).map(
          (preset) =>
            ({
              label: preset,
              type: 'radio',
              checked: config.selectedPreset === preset,
              click() {
                setConfig({ selectedPreset: preset });
              },
            }) satisfies MenuTemplate[number],
        ),
        { type: 'separator' },
        {
          label: t('plugins.downloader.menu.custom-preset.label'),
          async click() {
            const currentPreset =
              config.customPresetSetting ?? defaultConfig.customPresetSetting;
            const res = await prompt({
              title: t('plugins.downloader.menu.custom-preset.title'),
              type: 'multiInput',
              multiInputOptions: [
                {
                  label: t('plugins.downloader.menu.custom-preset.extension'),
                  value: currentPreset.extension ?? '',
                  inputAttrs: { type: 'text', placeholder: 'mp3' },
                },
                {
                  label: t('plugins.downloader.menu.custom-preset.ffmpeg-args'),
                  value: currentPreset.ffmpegArgs.join(' '),
                  inputAttrs: { type: 'text', placeholder: '-b:a 320k' },
                },
              ],
              ...promptOptions(),
              height: 240,
              resizable: true,
            }).catch(console.error);

            if (!res) {
              return;
            }

            const extension = String(res[0] ?? '').trim();
            setConfig({
              customPresetSetting: {
                extension: extension || null,
                ffmpegArgs: String(res[1] ?? '')
                  .split(' ')
                  .map((argument) => argument.trim())
                  .filter(Boolean),
              },
            });
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
    {
      label: t('plugins.downloader.menu.show-progress'),
      type: 'checkbox',
      checked: config.showProgress ?? true,
      click(item) {
        setConfig({ showProgress: item.checked });
      },
    },
    {
      label: t('plugins.downloader.menu.playlist-max-items.label'),
      async click() {
        const res = await prompt({
          title: t('plugins.downloader.menu.playlist-max-items.title'),
          label: t('plugins.downloader.menu.playlist-max-items.description'),
          type: 'input',
          value: String(config.playlistMaxItems ?? 0),
          inputAttrs: { type: 'number', min: '0', step: '1' },
          ...promptOptions(),
        }).catch(console.error);

        if (res === null || res === undefined) {
          return;
        }

        const value = Number(res);
        setConfig({
          playlistMaxItems:
            Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined,
        });
      },
    },
  ];
};
