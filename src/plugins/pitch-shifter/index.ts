import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { formatSemitones, MAX_SEMITONES, MIN_SEMITONES } from './constants';
import { onConfigChange, onPlayerApiReady, start, stop } from './renderer';

import type { MenuTemplate } from '@/menu';
import type { MenuContext } from '@/types/contexts';

export type PitchShifterPluginConfig = {
  enabled: boolean;
  /**
   * Pitch shift in semitones, from -12 to +12
   */
  semitones: number;
};

// The song-menu slider changes the config from the renderer, so the
// application menu has to be rebuilt to show the new selection. Changes made
// from the menu itself are skipped: the radio item already shows them, and
// rebuilding the menu during its own click handler confuses the in-app menu.
let refreshMenu: (() => Promise<void> | void) | undefined;
let menuSemitones: number | undefined;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;

export default createPlugin({
  name: () => t('plugins.pitch-shifter.name'),
  description: () => t('plugins.pitch-shifter.description'),
  restartNeeded: false,
  addedVersion: '3.12.X',
  config: {
    enabled: false,
    semitones: 0,
  } as PitchShifterPluginConfig,
  menu: async ({
    getConfig,
    setConfig,
    refresh,
  }: MenuContext<PitchShifterPluginConfig>): Promise<MenuTemplate> => {
    refreshMenu = refresh;
    const config = await getConfig();
    menuSemitones = config.semitones;

    const steps = [];
    for (let value = MAX_SEMITONES; value >= MIN_SEMITONES; value--) {
      steps.push(value);
    }

    return [
      {
        label: t('plugins.pitch-shifter.menu.semitones'),
        type: 'submenu',
        submenu: steps.map((value) => ({
          label: formatSemitones(value),
          type: 'radio',
          checked: config.semitones === value,
          click() {
            menuSemitones = value;
            setConfig({ semitones: value });
          },
        })),
      },
      {
        label: t('plugins.pitch-shifter.menu.reset'),
        click() {
          setConfig({ semitones: 0 });
        },
      },
    ];
  },
  backend: {
    start() {},
    onConfigChange({ semitones }) {
      if (semitones === menuSemitones) return;
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => refreshMenu?.(), 300);
    },
  },
  renderer: {
    start,
    stop,
    onConfigChange,
    onPlayerApiReady,
  },
});
