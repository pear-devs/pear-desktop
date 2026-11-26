import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { backend, clearCache } from './backend';
import { renderer } from './renderer';
import style from './style.css?inline';

export type KaraokeModePluginConfig = {
  enabled: boolean;
  /** Karaoke on: play the stems instead of the original mix */
  active: boolean;
  /** Vocal level while karaoke is on, 10–100% (0–100% with allowMute) */
  vocalVolume: number;
  /** Let the slider go below 10%, where Demucs artifacts become audible */
  allowMute: boolean;
  /** Separate each song as it starts; otherwise only on icon click */
  separateAlways: boolean;
  /** demucs model name, e.g. htdemucs or htdemucs_ft */
  model: string;
  demucsCommand: string;
  ytDlpCommand: string;
};

export const MODELS = ['htdemucs', 'htdemucs_ft'] as const;

export default createPlugin<
  typeof backend,
  unknown,
  typeof renderer,
  KaraokeModePluginConfig
>({
  name: () => t('plugins.karaoke-mode.name'),
  description: () => t('plugins.karaoke-mode.description'),
  restartNeeded: true,
  config: {
    enabled: false,
    active: false,
    vocalVolume: 30,
    allowMute: false,
    separateAlways: false,
    model: 'htdemucs',
    demucsCommand: 'demucs',
    ytDlpCommand: 'yt-dlp',
  },
  stylesheets: [style],

  async menu({ getConfig, setConfig }) {
    const config = await getConfig();

    return [
      {
        label: t('plugins.karaoke-mode.menu.separate-always.label'),
        toolTip: t('plugins.karaoke-mode.menu.separate-always.tooltip'),
        type: 'checkbox',
        checked: config.separateAlways,
        click(item) {
          setConfig({ separateAlways: item.checked });
        },
      },
      {
        label: t('plugins.karaoke-mode.menu.allow-mute.label'),
        toolTip: t('plugins.karaoke-mode.menu.allow-mute.tooltip'),
        type: 'checkbox',
        checked: config.allowMute,
        click(item) {
          setConfig({ allowMute: item.checked });
        },
      },
      {
        label: t('plugins.karaoke-mode.menu.model.label'),
        toolTip: t('plugins.karaoke-mode.menu.model.tooltip'),
        type: 'submenu',
        submenu: MODELS.map((model) => ({
          label: t(`plugins.karaoke-mode.menu.model.submenu.${model}`),
          type: 'radio',
          checked: config.model === model,
          click() {
            setConfig({ model });
          },
        })),
      },
      {
        label: t('plugins.karaoke-mode.menu.clear-cache.label'),
        toolTip: t('plugins.karaoke-mode.menu.clear-cache.tooltip'),
        click() {
          clearCache();
        },
      },
    ];
  },

  backend,
  renderer,
});
