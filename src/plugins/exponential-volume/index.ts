import { createPlugin } from '@/utils';
import { t } from '@/i18n';

import type { MusicPlayer } from '@/types/music-player';

export default createPlugin({
  name: () => t('plugins.exponential-volume.name'),
  description: () => t('plugins.exponential-volume.description'),
  restartNeeded: true,
  config: {
    enabled: false,
  },
  renderer: {
    onPlayerApiReady(playerApi) {
      const syncVolume = (playerApi: MusicPlayer) => {
        if (playerApi.getPlayerState() === 3) {
          setTimeout(() => syncVolume(playerApi), 0);
          return;
        }

        playerApi.setVolume(playerApi.getVolume());
      };

      // "fix volume ratio 0.4" by Marco Pfeiffer
      // https://bit.ly/4nMu2WF

      // Manipulation exponent, higher value = lower volume
      // 3 is the value used by pulseaudio, which Barteks2x figured out this gist here: https://gist.github.com/Barteks2x/a4e189a36a10c159bb1644ffca21c02a
      // 0.05 (or 5%) is the lowest you can select in the UI which with an exponent of 3 becomes 0.000125 or 0.0125%
      const EXPONENT = 3;

      const storedOriginalVolumes = new WeakMap<HTMLMediaElement, number>();
      const propertyDescriptor = Object.getOwnPropertyDescriptor(
        HTMLMediaElement.prototype,
        'volume',
      );
      Object.defineProperty(HTMLMediaElement.prototype, 'volume', {
        get(this: HTMLMediaElement) {
          const lowVolume =
            (propertyDescriptor?.get?.call(this) as number) ?? 0;
          const calculatedOriginalVolume = lowVolume ** (1 / EXPONENT);

          // The calculated value has some accuracy issues which can lead to problems for implementations that expect exact values.
          // To avoid this, I'll store the unmodified volume to return it when read here.
          // This mostly solves the issue, but the initial read has no stored value and the volume can also change though external influences.
          // To avoid ill effects, I check if the stored volume is somewhere in the same range as the calculated volume.
          const storedOriginalVolume = storedOriginalVolumes.get(this) ?? 0;
          const storedDeviation = Math.abs(
            storedOriginalVolume - calculatedOriginalVolume,
          );

          return storedDeviation < 0.01
            ? storedOriginalVolume
            : calculatedOriginalVolume;
        },
        set(this: HTMLMediaElement, originalVolume: number) {
          const lowVolume = originalVolume ** EXPONENT;
          storedOriginalVolumes.set(this, originalVolume);
          propertyDescriptor?.set?.call(this, lowVolume);
        },
      });
      syncVolume(playerApi);
    },
  },
});
