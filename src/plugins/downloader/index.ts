import { DefaultPresetList, type Preset } from './types';

import style from './style.css?inline';

import { createPlugin } from '@/utils';
import { onConfigChange, onMainLoad } from './main';
import { onPlayerApiReady, onRendererLoad } from './renderer';
import { onMenu } from './menu';
import { t } from '@/i18n';

export type DownloaderPluginConfig = {
  enabled: boolean;
  downloadFolder?: string;
  downloadOnFinish?: {
    enabled: boolean;
    seconds: number;
    percent: number;
    mode: 'percent' | 'seconds';
    folder?: string;
  };
  selectedPreset: string;
  customPresetSetting: Preset;
  skipExisting: boolean;
  playlistMaxItems?: number;
};

export const defaultConfig: DownloaderPluginConfig = {
  enabled: false,
  downloadFolder: undefined,
  downloadOnFinish: {
    enabled: false,
    seconds: 20,
    percent: 10,
    mode: 'seconds',
    folder: undefined,
  },
  selectedPreset: 'mp3 (256kbps)', // Selected preset
  customPresetSetting: DefaultPresetList['mp3 (256kbps)'], // Presets
  skipExisting: false,
  playlistMaxItems: undefined,
};

export default createPlugin({
  name: () => t('plugins.downloader.name'),
  description: () => t('plugins.downloader.description'),
  restartNeeded: true,
  config: defaultConfig,
  stylesheets: [style],
  menu: onMenu,
  backend: {
    start: onMainLoad,
    onConfigChange,
  },
  renderer: {
    start: onRendererLoad,
    onPlayerApiReady,
  },
});
