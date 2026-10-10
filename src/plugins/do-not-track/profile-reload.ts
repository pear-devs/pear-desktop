import { normalizeBlocker } from './types';

import type { TrackerBlockerConfig } from './index';

export const profileKey = (config: TrackerBlockerConfig) =>
  JSON.stringify({
    blocker: normalizeBlocker(config.blocker),
    customEnabled: config.customEnabled === true,
    ...(config.customEnabled
      ? {
          lists: config.additionalBlockLists,
          rules: config.additionalBlockListRules,
          disabledFiles: [...config.disabledLocalBlockLists].sort(),
          disableDefaultLists: config.disableDefaultLists,
        }
      : {}),
  });

export const createProfileReloadPrompt = ({
  show,
  translate,
  isActive,
  reload,
}: {
  show: (
    options: Electron.MessageBoxOptions,
  ) => Promise<Electron.MessageBoxReturnValue>;
  translate: (key: string) => string;
  isActive: () => boolean;
  reload: () => Promise<void>;
}) => {
  let pending = false;
  return async () => {
    if (pending || !isActive()) return;
    pending = true;
    try {
      const { response } = await show({
        type: 'info',
        title: translate('plugins.do-not-track.dialog.reload.title'),
        message: translate('plugins.do-not-track.dialog.reload.message'),
        detail: translate('plugins.do-not-track.dialog.reload.detail'),
        buttons: [
          translate('plugins.do-not-track.dialog.reload.reload-now'),
          translate('main.dialog.need-to-restart.buttons.later'),
        ],
        defaultId: 1,
        cancelId: 1,
      });
      if (response === 0 && isActive()) await reload();
    } finally {
      pending = false;
    }
  };
};
