import { ElectronBlocker } from '@ghostery/adblocker-electron';
import { net } from 'electron';

let blocker: ElectronBlocker | undefined;

export const DEFAULT_LISTS = [
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/badware.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/privacy.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters-2021.txt',
  'https://raw.githubusercontent.com/easylist/easylist/master/easylist/easylist.txt',
];

export const loadAdblockerEngine = async (
  session: Electron.Session,
  additionalBlockLists: string[] = [],
) => {
  try {
    blocker = await ElectronBlocker.fromLists(
      (url: string) => net.fetch(url),
      [...DEFAULT_LISTS, ...additionalBlockLists],
      {
        enableCompression: true,
        loadNetworkFilters: true,
      },
      undefined,
    );
    blocker.enableBlockingInSession(session);
  } catch (error) {
    console.error('[AdBlock] Error loading blocker engine', error);
  }
};

export const unloadAdblockerEngine = (session: Electron.Session) => {
  if (blocker) {
    blocker.disableBlockingInSession(session);
    blocker = undefined;
  }
};
