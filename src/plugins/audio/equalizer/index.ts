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

// Try to import Rust native module (fallback to Web Audio API if not available)
let rustEqualizer: any = null;
let rustAvailable = false;

// Check Rust module availability asynchronously
const checkRustAvailability = async (): Promise<boolean> => {
  if (rustAvailable) return true;
  try {
    const nativeModule = await import('@/native/index').catch(() => null);
    if (nativeModule) {
      rustAvailable = true;
      return true;
    }
  } catch {
    // Rust module not available, will use Web Audio API fallback
  }
  return false;
};

// Map Web Audio API filter types to Rust filter types
const mapFilterTypeToRust = (type: BiquadFilterType): any => {
  const typeMap: Record<string, number> = {
    lowpass: 0,
    highpass: 1,
    bandpass: 2,
    lowshelf: 3,
    highshelf: 4,
    peaking: 5,
    notch: 6,
    allpass: 7,
  };
  return typeMap[type] ?? 3; // Default to lowshelf
};

// Convert plugin FilterConfig to Rust FilterConfig
const convertToRustConfig = (
  filter: FilterConfig,
  sampleRate: number,
): any => {
  return {
    filter_type: mapFilterTypeToRust(filter.type),
    frequency: filter.frequency,
    q: filter.Q,
    gain: filter.gain,
  };
};

export type EqualizerPluginConfig = {
  enabled: boolean;
  filters: FilterConfig[];
  presets: { [preset in Preset]: boolean };
};

let appliedFilters: BiquadFilterNode[] = [];
let rustEqualizerInstance: any = null;
let currentAudioContext: AudioContext | null = null;

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
          currentAudioContext = audioContext;
          const filtersToApply = config.filters.concat(
            defaultPresets
              .filter((preset) => config.presets[preset])
              .map((preset) => presetConfigs[preset]),
          );

          if (filtersToApply.length > 0) {
            // Try to use Rust module for better performance
            checkRustAvailability().then((available) => {
              if (available) {
                try {
                  import('@/native/index').then(async (nativeModule) => {
                    const { createEqualizer } = nativeModule;
                    const rustConfigs = filtersToApply.map((filter) =>
                      convertToRustConfig(filter, audioContext.sampleRate),
                    );

                    rustEqualizerInstance = createEqualizer(
                      rustConfigs,
                      audioContext.sampleRate,
                    );

                    if (rustEqualizerInstance) {
                      // Create a ScriptProcessorNode or use AudioWorklet for real-time processing
                      // For now, we'll use Web Audio API but could be enhanced with AudioWorklet
                      console.log(
                        '[Equalizer] Rust module loaded but using Web Audio API for real-time processing',
                      );
                      // Fallback to Web Audio API for now as real-time processing
                      // with Rust requires AudioWorklet integration
                      setupWebAudioFilters(audioSource, audioContext, filtersToApply);
                    } else {
                      setupWebAudioFilters(audioSource, audioContext, filtersToApply);
                    }
                  }).catch((error) => {
                    console.warn('[Equalizer] Failed to load Rust module, using Web Audio API', error);
                    setupWebAudioFilters(audioSource, audioContext, filtersToApply);
                  });
                } catch (error) {
                  console.warn('[Equalizer] Failed to load Rust module, using Web Audio API', error);
                  setupWebAudioFilters(audioSource, audioContext, filtersToApply);
                }
              } else {
                // Use Web Audio API fallback
                setupWebAudioFilters(audioSource, audioContext, filtersToApply);
              }
            });
          }
        },
        { once: true, passive: true },
      );
    },
    stop() {
      appliedFilters.forEach((filter) => filter.disconnect());
      appliedFilters = [];
      rustEqualizerInstance = null;
      currentAudioContext = null;
    },
  },
});

// Helper function to setup Web Audio API filters
function setupWebAudioFilters(
  audioSource: MediaElementAudioSourceNode,
  audioContext: AudioContext,
  filters: FilterConfig[],
) {
  filters.forEach((filter) => {
    const biquadFilter = audioContext.createBiquadFilter();
    biquadFilter.type = filter.type;
    biquadFilter.frequency.value = filter.frequency;
    biquadFilter.Q.value = filter.Q;
    biquadFilter.gain.value = filter.gain;

    audioSource.connect(biquadFilter);
    biquadFilter.connect(audioContext.destination);

    appliedFilters.push(biquadFilter);
  });
}
