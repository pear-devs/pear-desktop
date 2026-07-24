import { ElectronBlocker } from '@ghostery/adblocker-electron';
import { net } from 'electron';

let blocker: ElectronBlocker | undefined;
let generation = 0;

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
  const gen = ++generation;
  try {
    const b = await ElectronBlocker.fromLists(
      (url: string) => net.fetch(url),
      [...DEFAULT_LISTS, ...additionalBlockLists],
      {
        enableCompression: true,
        loadNetworkFilters: true,
      },
      undefined,
    );
    if (gen !== generation) {
      b.disableBlockingInSession(session);
      return;
    }
    const prev = blocker;
    blocker = b;
    blocker.enableBlockingInSession(session);
    if (prev) prev.disableBlockingInSession(session);
  } catch (error) {
    if (gen === generation) {
      console.error('[AdBlock] Error loading blocker engine', error);
    }
  }
};

export const unloadAdblockerEngine = (session: Electron.Session) => {
  generation++;
  if (blocker) {
    blocker.disableBlockingInSession(session);
    blocker = undefined;
  }
};
