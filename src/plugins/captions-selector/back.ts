import prompt from 'custom-electron-prompt';

import { t } from '@/i18n';
import promptOptions from '@/providers/prompt-options';
import { createBackend } from '@/utils';

import type { CaptionsSelectorIpc, captionsSelectorConfig } from './types';

export default createBackend<
  typeof captionsSelectorConfig,
  CaptionsSelectorIpc
>(({ ipc, window }) => {
  ipc.handle('pickCaptions', async (captionLabels, currentIndex) => {
    const index = await prompt(
      {
        title: t('plugins.captions-selector.prompt.selector.title'),
        label: t('plugins.captions-selector.prompt.selector.label', {
          language:
            captionLabels[currentIndex] ||
            t('plugins.captions-selector.prompt.selector.none'),
        }),
        type: 'select',
        value: currentIndex,
        selectOptions: captionLabels,
        resizable: true,
        ...promptOptions(),
      },
      window,
    );
    return index === null ? null : Number(index);
  });
});
