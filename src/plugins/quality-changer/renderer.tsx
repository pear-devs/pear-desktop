import { render } from 'solid-js/web';

import { t } from '@/i18n';
import { createRenderer } from '@/utils';

import { QualitySettingButton } from './templates/quality-setting-button';

import type { QualityChangerIpc } from './types';
import type { Empty } from '@/types/plugins';

export default createRenderer<Empty, QualityChangerIpc>((ctx) => {
  ctx.onPlayerApiReady((api) => {
    const chooseQuality = async (e: MouseEvent) => {
      e.stopPropagation();

      const qualityLevels = api.getAvailableQualityLevels();

      const currentIndex = qualityLevels.indexOf(api.getPlaybackQuality());

      const response = await ctx.ipc.invoke(
        'pickQuality',
        api.getAvailableQualityLabels(),
        currentIndex,
      );

      if (response === -1) {
        return;
      }

      const newQuality = qualityLevels[response];
      api.setPlaybackQualityRange(newQuality);
      api.setPlaybackQuality(newQuality);
    };

    const container = document.createElement('div');
    const dispose = render(
      () => (
        <QualitySettingButton
          label={t(
            'plugins.quality-changer.renderer.quality-settings-button.label',
          )}
          onClick={chooseQuality}
        />
      ),
      container,
    );
    ctx.onCleanup(() => {
      dispose();
      container.remove();
    });

    document
      .querySelector('.top-row-buttons.ytmusic-player')
      ?.prepend(container);
  });
});
