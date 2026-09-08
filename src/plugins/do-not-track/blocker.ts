import { networkFilterService } from '@/services/network-filter';

export const loadTrackerBlockerEngine = async (
  session?: Electron.Session,
  cache: boolean = true,
  additionalBlockLists: string[] = [],
  disableDefaultLists: boolean | unknown[] = false,
) => {
  const disableDefaults =
    (disableDefaultLists && !Array.isArray(disableDefaultLists)) ||
    (Array.isArray(disableDefaultLists) && disableDefaultLists.length > 0);

  await networkFilterService.initialize(session, {
    cache,
    additionalBlockLists,
    disableDefaultLists: disableDefaults,
  });
};

export const unloadTrackerBlockerEngine = (session: Electron.Session) => {
  networkFilterService.disable(session);
};

export const isBlockerEnabled = (session: Electron.Session) =>
  networkFilterService.isEnabled(session);
