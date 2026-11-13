import { globalShortcut } from 'electron';

import { createBackend } from '@/utils';

import type { PreciseVolumeIpc, preciseVolumeConfig } from './types';

export default createBackend<typeof preciseVolumeConfig, PreciseVolumeIpc>(
  (ctx) => {
    const { volumeUp, volumeDown } = ctx.config.globalShortcuts;

    const register = (accelerator: string, toIncrease: boolean) => {
      if (!accelerator) return;
      const registered = globalShortcut.register(accelerator, () =>
        ctx.ipc.send('changeVolume', toIncrease),
      );
      if (registered) {
        ctx.onCleanup(() => globalShortcut.unregister(accelerator));
      }
    };

    register(volumeUp, true);
    register(volumeDown, false);
  },
);
