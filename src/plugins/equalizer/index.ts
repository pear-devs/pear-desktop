import { t } from '@/i18n';
import { config } from '@/plugins/utils/common/config';
import { createPlugin } from '@/utils';

import { defaultPresets, presetConfigs, type FilterConfig } from './presets';

export default createPlugin({
  name: () => t('plugins.equalizer.name'),
  description: () => t('plugins.equalizer.description'),
  restartNeeded: false,
  addedVersion: '3.7.X',
  config: {
    filters: config.hidden<FilterConfig[]>([]),
    presets: config.group(
      {
        'bass-booster': config.bool(false, {
          label: 'plugins.equalizer.menu.presets.list.bass-booster',
        }),
      },
      { label: 'plugins.equalizer.menu.presets.label' },
    ),
  },
  renderer(ctx) {
    const appliedFilters: {
      source: MediaElementAudioSourceNode;
      filter: BiquadFilterNode;
    }[] = [];

    ctx.onCleanup(() => {
      for (const { source, filter } of appliedFilters) {
        try {
          source.disconnect(filter);
        } catch {}
        filter.disconnect();
      }
    });

    ctx.listen(
      document,
      'peard:audio-can-play',
      ({ detail: { audioSource, audioContext } }) => {
        const filtersToApply = ctx.config.filters.concat(
          defaultPresets
            .filter((preset) => ctx.config.presets[preset])
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

          appliedFilters.push({ source: audioSource, filter: biquadFilter });
        });
      },
      { once: true, passive: true },
    );
  },
});
