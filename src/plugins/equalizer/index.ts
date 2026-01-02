import { createPlugin } from '@/utils';
import { t } from '@/i18n';

import {
  defaultPresets,
  presetConfigs,
  type Preset,
  type FilterConfig,
} from './presets';

import type { MenuContext } from '@/types/contexts';
import type { MenuTemplate } from '@/menu';

export type EqualizerPluginConfig = {
  enabled: boolean;
  filters: FilterConfig[];
  presets: { [preset in Preset]: boolean };
};

let appliedFilters: BiquadFilterNode[] = [];

export default createPlugin({
  name: () => t('plugins.equalizer.name'),
  description: () => t('plugins.equalizer.description'),
  restartNeeded: false,
  addedVersion: '3.7.X',
  config: {
    enabled: false,
    filters: [],
    presets: { 'bass-booster': false },
  } as EqualizerPluginConfig,
  menu: async ({
    getConfig,
    setConfig,
  }: MenuContext<EqualizerPluginConfig>): Promise<MenuTemplate> => {
    const config = await getConfig();

    return [
      {
        label: t('plugins.equalizer.menu.presets.label'),
        type: 'submenu',
        submenu: defaultPresets.map((preset) => ({
          label: t(`plugins.equalizer.menu.presets.list.${preset}`),
          type: 'radio',
          checked: config.presets[preset],
          click() {
            setConfig({
              presets: { ...config.presets, [preset]: !config.presets[preset] },
            });
          },
        })),
      },
    ];
  },
  renderer: {
    async start({ getConfig }) {
      const config = await getConfig();

      document.addEventListener(
        'peard:audio-can-play',
        ({ detail: { audioSource, audioContext } }) => {
          const filtersToApply = config.filters.concat(
            defaultPresets
              .filter((preset) => config.presets[preset])
              .map((preset) => presetConfigs[preset]),
          );
          filtersToApply.forEach((filter) => {
            const biquadFilter = audioContext.createBiquadFilter();
            biquadFilter.type = filter.type;
            biquadFilter.frequency.value = filter.frequency; // filter frequency in Hz
            biquadFilter.Q.value = filter.Q;
            biquadFilter.gain.value = filter.gain; // filter gain in dB

            audioSource.connect(biquadFilter);
            biquadFilter.connect(audioContext.destination);

            appliedFilters.push(biquadFilter);
          });
        },
        { once: true, passive: true },
      );
    },
    stop() {
      appliedFilters.forEach((filter) => filter.disconnect());
      appliedFilters = [];
    },
  },
});
