import { networkFilterService } from '@/services/network-filter';

/**
 * Loads and initializes the tracker blocker engine for an Electron session.
 *
 * @param session - Optional Electron session to attach the network filter to.
 * @param cache - Whether to enable binary disk caching of compiled filter rules. Defaults to true.
 * @param additionalBlockLists - Extra URLs pointing to adblock/privacy filter lists to load.
 * @param disableDefaultLists - Flag or array indicating whether default filter lists should be skipped.
 */
export const loadTrackerBlockerEngine = async (
  session?: Electron.Session,
  cache: boolean = true,
  additionalBlockLists: string[] = [],
  disableDefaultLists: boolean | unknown[] = false,
): Promise<void> => {
  const disableDefaults =
    (disableDefaultLists && !Array.isArray(disableDefaultLists)) ||
    (Array.isArray(disableDefaultLists) && disableDefaultLists.length > 0);

  await networkFilterService.initialize(session, {
    cache,
    additionalBlockLists,
    disableDefaultLists: disableDefaults,
  });
};

/**
 * Unloads and detaches the network filter engine from an active Electron session.
 *
 * @param session - The Electron session to detach the filter interceptor from.
 */
export const unloadTrackerBlockerEngine = (session: Electron.Session): void => {
  networkFilterService.disable(session);
};

/**
 * Checks whether the tracker blocker is currently enabled on a given Electron session.
 *
 * @param session - The Electron session to inspect.
 * @returns True if network filtering is actively enabled on the session.
 */
export const isBlockerEnabled = (session: Electron.Session): boolean =>
  networkFilterService.isEnabled(session);
