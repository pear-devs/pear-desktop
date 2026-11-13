import prompt from 'custom-electron-prompt';

import promptOptions from '@/providers/prompt-options';
import { createBackend } from '@/utils';

import type { MusicTogetherIpc } from './types';
import type { Empty } from '@/types/plugins';

export default createBackend<Empty, MusicTogetherIpc>(({ ipc }) => {
  ipc.handle('prompt', (title, label) =>
    prompt({
      title,
      label,
      type: 'input',
      ...promptOptions(),
    }),
  );
});
