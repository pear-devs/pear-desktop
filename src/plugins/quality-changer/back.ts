import { dialog } from 'electron';

import { t } from '@/i18n';
import { createBackend } from '@/utils';

import type { QualityChangerIpc } from './types';
import type { Empty } from '@/types/plugins';

export default createBackend<Empty, QualityChangerIpc>(({ ipc, window }) => {
  ipc.handle('pickQuality', async (qualityLabels, currentIndex) => {
    const { response } = await dialog.showMessageBox(window, {
      type: 'question',
      buttons: qualityLabels,
      defaultId: currentIndex,
      title: t('plugins.quality-changer.backend.dialog.quality-changer.title'),
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
    });
    return response;
  });
});
