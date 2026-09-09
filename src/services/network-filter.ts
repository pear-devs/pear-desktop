import fs, { promises } from 'node:fs';
import path from 'node:path';

import {
  ElectronBlocker,
  fromElectronDetails,
  type Request,
} from '@ghostery/adblocker-electron';
import { app, net, type Session } from 'electron';
import * as z from 'zod';

/**
 * Validates whether a given URL string is a secure HTTPS protocol URL.
 *
 * @param value - The URL string to validate.
 * @returns True if the string parses as a valid URL with https: protocol.
 */
export const isValidHttpsUrl = (value: string): boolean => {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};

const TbSourcesSchema = z.object({
  tb: z.array(
    z.string().refine(isValidHttpsUrl, {
      message: 'Filter list entries must be secure https URLs',
    }),
  ),
});

// Fallback lists if remote schema fails or is offline (standard EasyList + EasyPrivacy filters)
const DEFAULT_FALLBACK_LISTS = [
  'https://easylist.to/easylist/easylist.txt',
  'https://easylist.to/easylist/easyprivacy.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/privacy.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/badware.txt',
];

export interface NetworkFilterOptions {
  cache?: boolean;
  additionalBlockLists?: string[];
  disableDefaultLists?: boolean;
}

/**
 * Native Network Filter Service inspired by Brave Shields architecture.
 * Operates purely within the Main Process at the Chromium webRequest level,
 * evaluating outgoing network requests against in-memory filter rules
 * and cancelling matches with net::ERR_BLOCKED_BY_CLIENT.
 */
export class NetworkFilterService {
  private static instance: NetworkFilterService;
  private engine: ElectronBlocker | null = null;
  private activeSessions = new Map<Session, string | null>();
  private currentLoadingPromise: Promise<void> | null = null;
  private pendingReload: (() => Promise<void>) | null = null;
  /**
   * Resolves the cache directory path on demand within the main process.
   *
   * @returns The absolute path to the tb_cache directory in userData.
   */
  private get cacheDir(): string {
    return path.join(app.getPath('userData'), 'tb_cache');
  }

  /**
   * Private constructor for the singleton pattern.
   * Defers filesystem operations and main-process Electron API calls
   * so that importing this module in preload or renderer scripts is safe.
   */
  private constructor() {
    // Intentionally empty for safe module evaluation across all Electron processes
  }

  /**
   * Ensures that the cache directory exists on disk, creating it recursively if needed.
   */
  private ensureCacheDir(): void {
    const dir = this.cacheDir;
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (err) {
        console.error(
          '[NetworkFilterService] Failed to create cache directory',
          err,
        );
      }
    }
  }

  /**
   * Retrieves the singleton instance of the NetworkFilterService.
   *
   * @returns The active NetworkFilterService instance.
   */
  public static getInstance(): NetworkFilterService {
    if (!NetworkFilterService.instance) {
      NetworkFilterService.instance = new NetworkFilterService();
    }
    return NetworkFilterService.instance;
  }

  /**
   * Initializes or reloads the in-memory native filter engine.
   * Coalesces concurrent calls and guarantees that any configuration change
   * requested while an initialization is in flight will automatically re-run
   * with the latest parameters once the current run completes.
   *
   * @param session - Optional Electron session to attach the network filter to.
   * @param options - Configuration options for filter lists and caching.
   * @returns A promise that resolves when the filter engine is fully loaded and attached.
   */
  public async initialize(
    session?: Session,
    options: NetworkFilterOptions = {},
  ): Promise<void> {
    this.ensureCacheDir();

    const run = () => this.doInitialize(session, options);

    if (this.currentLoadingPromise) {
      this.pendingReload = run;
      return this.currentLoadingPromise;
    }

    this.currentLoadingPromise = (async () => {
      try {
        await run();
      } finally {
        this.currentLoadingPromise = null;
        const next = this.pendingReload;
        this.pendingReload = null;
        if (next) {
          await next();
        }
      }
    })();

    return this.currentLoadingPromise;
  }

  /**
   * Internal implementation that builds the native filter engine from remote
   * or cached blocklists and attaches it to the specified Electron session.
   *
   * @param session - Optional Electron session to attach the filter interceptor to.
   * @param options - Configuration options controlling caching and blocklists.
   * @returns A promise that resolves when the filter engine is built and enabled.
   */
  private async doInitialize(
    session?: Session,
    options: NetworkFilterOptions = {},
  ): Promise<void> {
    const {
      cache = true,
      additionalBlockLists = [],
      disableDefaultLists = false,
    } = options;

    try {
      const cachePath = path.join(this.cacheDir, 'tb-engine.bin');
      const shouldUseCache =
        cache && additionalBlockLists.length === 0 && !disableDefaultLists;

      const cachingOptions = shouldUseCache
        ? {
            path: cachePath,
            read: promises.readFile,
            write: promises.writeFile,
          }
        : undefined;

      let defaultLists: string[] = [];
      if (!disableDefaultLists) {
        try {
          const response = await net.fetch(
            'https://raw.githubusercontent.com/organization/tb-list/refs/heads/main/tb.json',
          );
          if (response.ok) {
            const parsed = TbSourcesSchema.safeParse(await response.json());
            if (parsed.success && parsed.data.tb.length > 0) {
              defaultLists = parsed.data.tb;
            }
          }
        } catch {
          // In case of network failure / offline mode, fall back to default filter URLs
          defaultLists = DEFAULT_FALLBACK_LISTS;
        }

        if (defaultLists.length === 0) {
          defaultLists = DEFAULT_FALLBACK_LISTS;
        }
      }

      const lists = [...defaultLists, ...additionalBlockLists].filter(isValidHttpsUrl);

      // Build native engine in memory.
      // loadCosmeticFilters is explicitly false to ensure ZERO DOM/script injection.
      this.engine = await ElectronBlocker.fromLists(
        (url: string) => net.fetch(url),
        lists,
        {
          enableCompression: true,
          loadNetworkFilters: true,
          loadCosmeticFilters: false,
          guessRequestTypeFromUrl: true,
        },
        cachingOptions,
      );

      if (session) {
        this.enable(session);
      }
    } catch (error) {
      console.error(
        '[NetworkFilterService] Error loading native filter engine:',
        error,
      );
    }
  }

  /**
   * Synchronously evaluates an outgoing request against the in-memory rules engine.
   *
   * @param details - Electron webRequest details for the outgoing request.
   * @returns A response indicating whether the request should be cancelled.
   */
  public matchRequest(
    details: Electron.OnBeforeRequestListenerDetails,
  ): Electron.CallbackResponse {
    if (!this.engine) {
      return { cancel: false };
    }

    const request: Request = fromElectronDetails(details);

    // Never cancel the main frame navigation
    if (request.isMainFrame()) {
      return { cancel: false };
    }

    const { match, redirect } = this.engine.match(request);

    if (match || redirect) {
      // Aborts request before DNS/HTTP connection, cleanly yielding net::ERR_BLOCKED_BY_CLIENT
      return { cancel: true };
    }

    return { cancel: false };
  }

  /**
   * Attaches the deep network interceptor to an Electron Session.
   * Stores the returned listener ID to allow clean removal through the enhanced API.
   *
   * @param session - The Electron session to attach the network interceptor to.
   */
  public enable(session: Session): void {
    if (this.activeSessions.has(session)) {
      return;
    }

    const registration = (session.webRequest.onBeforeRequest as unknown as (
      filter: { urls: string[] },
      listener: (
        details: Electron.OnBeforeRequestListenerDetails,
        callback: (response: Electron.CallbackResponse) => void,
      ) => void,
    ) => { id?: string } | void)(
      { urls: ['<all_urls>'] },
      (details, callback) => {
        try {
          const response = this.matchRequest(details);
          callback(response);
        } catch (err) {
          console.error('[NetworkFilterService] Interception error:', err);
          callback({ cancel: false });
        }
      },
    );

    const listenerId =
      registration && typeof registration === 'object' && 'id' in registration
        ? (registration as { id: string }).id
        : null;

    this.activeSessions.set(session, listenerId);
  }

  /**
   * Detaches the network interceptor from an Electron Session using the enhanced removeListener API.
   *
   * @param session - The Electron session to detach the network interceptor from.
   */
  public disable(session: Session): void {
    if (!this.activeSessions.has(session)) {
      return;
    }

    const listenerId = this.activeSessions.get(session);
    this.activeSessions.delete(session);

    try {
      const enhancedWebRequest = session.webRequest as unknown as {
        removeListener?: (method: string, id: string) => void;
      };

      if (listenerId && typeof enhancedWebRequest.removeListener === 'function') {
        enhancedWebRequest.removeListener('onBeforeRequest', listenerId);
      } else {
        // Fallback for native unenhanced Electron session
        session.webRequest.onBeforeRequest(null);
      }
    } catch (err) {
      console.error(
        '[NetworkFilterService] Error detaching interceptor:',
        err,
      );
    }
  }

  /**
   * Checks whether the network filter is actively attached to the given session.
   *
   * @param session - The Electron session to check.
   * @returns True if the session has active network filtering enabled.
   */
  public isEnabled(session: Session): boolean {
    return this.activeSessions.has(session);
  }
}

export const networkFilterService = NetworkFilterService.getInstance();
