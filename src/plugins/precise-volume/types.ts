import { config } from '@/plugins/utils/common/config';

export const preciseVolumeConfig = {
  /** Enable ArrowUp + ArrowDown local shortcuts */
  arrowsShortcut: config.bool(true, {
    label: 'plugins.precise-volume.menu.arrows-shortcuts',
  }),
  globalShortcuts: config.group(
    {
      volumeUp: config.shortcut('', {
        label:
          'plugins.precise-volume.prompt.global-shortcuts.keybind-options.increase',
      }),
      volumeDown: config.shortcut('', {
        label:
          'plugins.precise-volume.prompt.global-shortcuts.keybind-options.decrease',
      }),
    },
    { label: 'plugins.precise-volume.menu.global-shortcuts' },
  ),
  /** Percentage of volume to change */
  steps: config.number(1, {
    label: 'plugins.precise-volume.menu.custom-volume-steps',
    min: 0,
    max: 100,
  }),
  /** The volume saved between sessions */
  savedVolume: config.hidden<number | undefined>(undefined),
};

export type PreciseVolumeIpc = {
  toRenderer: { changeVolume: [toIncrease: boolean] };
};
