import { config } from '@/plugins/utils/common/config';

import { DefaultPresetList, type Preset } from './types';

export const downloaderConfig = {
  selectedPreset: config.select(
    'mp3 (256kbps)',
    Object.keys(DefaultPresetList).map((value) => ({ value })),
    { label: 'plugins.downloader.menu.presets' },
  ),
  skipExisting: config.bool(false, {
    label: 'plugins.downloader.menu.skip-existing',
  }),
  // Edited by the custom "Download on finish" submenu (see menu.ts).
  downloadOnFinish: config.group({
    enabled: config.bool(false),
    seconds: config.number(20, { min: 0 }),
    percent: config.number(10, { min: 1, max: 100 }),
    mode: config.select('seconds', [
      { value: 'seconds' },
      { value: 'percent' },
    ]),
    folder: config.hidden<string | undefined>(undefined),
  }),
  downloadFolder: config.hidden<string | undefined>(undefined),
  customPresetSetting: config.hidden<Preset>(
    DefaultPresetList['mp3 (256kbps)'],
  ),
  playlistMaxItems: config.hidden<number | undefined>(undefined),
};

export type DownloaderIpc = {
  invoke: {
    downloadSong(url: string): void;
    downloadPlaylist(url: string): void;
  };
  toRenderer: {
    /** The download button's text; empty for the default one. */
    feedback: [message?: string | null];
  };
};
