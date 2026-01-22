import { dialog } from 'electron';

import { render } from 'solid-js/web';

import { createPlugin } from '@/utils';
import { t } from '@/i18n';

import { QualitySettingButton } from './templates/quality-setting-button';

import type { MusicPlayer } from '@/types/music-player';

export default createPlugin({
  name: () => t('plugins.quality-changer.name'),
  description: () => t('plugins.quality-changer.description'),
  restartNeeded: false,
  config: {
    enabled: false,
  },

  backend({ ipc, window }) {
    ipc.handle(
      'peard:quality-changer',
      async (qualityLabels: string[], currentIndex: number) =>
        await dialog.showMessageBox(window, {
          type: 'question',
          buttons: qualityLabels,
          defaultId: currentIndex,
          title: t(
            'plugins.quality-changer.backend.dialog.quality-changer.title',
          ),
          message: t(
            'plugins.quality-changer.backend.dialog.quality-changer.message',
          ),
          detail: t(
            'plugins.quality-changer.backend.dialog.quality-changer.detail',
            {
              quality: qualityLabels[currentIndex],
            },
          ),
          cancelId: -1,
        }),
    );
  },

  renderer: {
    qualitySettingsButtonContainer: document.createElement('div'),
    onPlayerApiReady(api: MusicPlayer, context) {
      const chooseQuality = async (e: MouseEvent) => {
        e.stopPropagation();

        const qualityLevels = api.getAvailableQualityLevels();

        const currentIndex = qualityLevels.indexOf(api.getPlaybackQuality());

        const quality = (await context.ipc.invoke(
          'peard:quality-changer',
          api.getAvailableQualityLabels(),
          currentIndex,
        )) as {
          response: number;
        };

        if (quality.response === -1) {
          return;
        }

        const newQuality = qualityLevels[quality.response];
        api.setPlaybackQualityRange(newQuality);
        api.setPlaybackQuality(newQuality);
      };

      render(
        () => (
          <QualitySettingButton
            label={t(
              'plugins.quality-changer.renderer.quality-settings-button.label',
            )}
            onClick={chooseQuality}
          />
        ),
        this.qualitySettingsButtonContainer,
      );

      const setup = () => {
        document
          .querySelector('.top-row-buttons.ytmusic-player')
          ?.prepend(this.qualitySettingsButtonContainer);
      };

      setup();
    },
    stop() {
      document
        .querySelector('.top-row-buttons.ytmusic-player')
        ?.removeChild(this.qualitySettingsButtonContainer);
    },
  },
});
