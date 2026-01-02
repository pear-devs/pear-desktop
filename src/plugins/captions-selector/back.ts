import prompt from 'custom-electron-prompt';

import promptOptions from '@/providers/prompt-options';
import { createBackend } from '@/utils';
import { t } from '@/i18n';

export default createBackend({
  start({ ipc: { handle }, window }) {
    handle(
      'peard:captions-selector',
      async (captionLabels: Record<string, string>, currentIndex: string) =>
        await prompt(
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
        ),
    );
  },
  stop({ ipc: { removeHandler } }) {
    removeHandler('captionsSelector');
  },
});
