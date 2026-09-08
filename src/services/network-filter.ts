import fs, { promises } from 'node:fs';
import path from 'node:path';

import {
  ElectronBlocker,
  fromElectronDetails,
  type Request,
} from '@ghostery/adblocker-electron';
import { app, net, type Session } from 'electron';
import * as z from 'zod';

const TbSourcesSchema = z.object({
  tb: z.array(z.string()),
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
  private activeSessions = new Set<Session>();
  private isLoading = false;
  private readonly cacheDir = path.join(app.getPath('userData'), 'tb_cache');

  private constructor() {
    if (!fs.existsSync(this.cacheDir)) {
      try {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      } catch (err) {
        console.error(
          '[NetworkFilterService] Failed to create cache directory',
          err,
        );
      }
    }
  }

  public static getInstance(): NetworkFilterService {
    if (!NetworkFilterService.instance) {
      NetworkFilterService.instance = new NetworkFilterService();
    }
    return NetworkFilterService.instance;
  }

  /**
   * Initializes or reloads the in-memory native filter engine.
   */
  public async initialize(
    session?: Session,
    options: NetworkFilterOptions = {},
  ): Promise<void> {
    const {
      cache = true,
      additionalBlockLists = [],
      disableDefaultLists = false,
    } = options;

    if (this.isLoading) return;
    this.isLoading = true;

    try {
      const cachePath = path.join(this.cacheDir, 'tb-engine.bin');
      const shouldUseCache = cache && additionalBlockLists.length === 0;

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

      const lists = [...defaultLists, ...additionalBlockLists];

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
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Synchronously evaluates an outgoing request against the in-memory rules engine.
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
   */
  public enable(session: Session): void {
    if (this.activeSessions.has(session)) {
      return;
    }

    this.activeSessions.add(session);

    session.webRequest.onBeforeRequest(
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
  }

  /**
   * Detaches the network interceptor from an Electron Session.
   */
  public disable(session: Session): void {
    if (this.activeSessions.has(session)) {
      this.activeSessions.delete(session);
      try {
        session.webRequest.onBeforeRequest(null);
      } catch (err) {
        console.error(
          '[NetworkFilterService] Error detaching interceptor:',
          err,
        );
      }
    }
  }

  public isEnabled(session: Session): boolean {
    return this.activeSessions.has(session);
  }
}

export const networkFilterService = NetworkFilterService.getInstance();
