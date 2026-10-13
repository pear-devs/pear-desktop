import fs, { promises } from 'node:fs';
import path from 'node:path';

import { ElectronBlocker } from '@ghostery/adblocker-electron';
import { type BetterSession } from '@jellybrick/electron-better-web-request';
import { app, net } from 'electron';

let blocker: ElectronBlocker | undefined;
let loadingBlocker: Promise<ElectronBlocker> | undefined;
let onBeforeRequestListenerId: string | undefined;
let onBeforeSendHeadersListenerId: string | undefined;

export const BLACKLISTS = [
  'https://easylist.to/easylist/easylist.txt',
  'https://easylist.to/easylist/easyprivacy.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/unbreak.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/privacy.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/annoyances.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/badware.txt',
  'https://raw.githubusercontent.com/brave/adblock-lists/master/brave-lists/brave-firstparty.txt',
  'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&mimetype=plaintext',
  'https://raw.githubusercontent.com/AdguardTeam/FiltersRegistry/master/filters/filter_2_Base/filter.txt',
  'https://raw.githubusercontent.com/AdguardTeam/FiltersRegistry/master/filters/filter_3_Spyware/filter.txt',
  'https://raw.githubusercontent.com/AdguardTeam/FiltersRegistry/master/filters/filter_11_Mobile/filter.txt',
  'https://raw.githubusercontent.com/AdguardTeam/FiltersRegistry/master/filters/filter_14_Annoyances/filter.txt',
];

const KNOWN_AD_PATTERNS = [
  '*://*.doubleclick.net/*',
  '*://*.googlesyndication.com/*',
  '*://*.googleadservices.com/*',
  '*://*.google-analytics.com/*',
  '*://*.googletagmanager.com/*',
  '*://*.google.com/pagead/*',
  '*://*.youtube.com/pagead/*',
  '*://*.youtube.com/api/stats/ads*',
  '*://*.youtube.com/api/stats/atr*',
  '*://*.youtube.com/api/stats/delayplay*',
  '*://*.youtube.com/ptracking*',
  '*://*.youtube.com/get_midroll_info*',
  '*://*.youtube.com/youtubei/v1/log_event*',
  '*://*.youtube.com/api/stats/qoe*',
  '*://*.youtube.com/api/stats/watchtime*',
  '*://*.youtube.com/generate_204*',
  '*://*.googlevideo.com/videoplayback?*ctier=L*',
  '*://*.googlevideo.com/videoplayback?*oad*',
  '*://*.scorecardresearch.com/*',
  '*://*.comscore.com/*',
  '*://*.quantserve.com/*',
  '*://*.innovid.com/*',
  '*://*.moatads.com/*',
  '*://*.imrworldwide.com/*',
  '*://*.adsrvr.org/*',
  '*://*.2mdn.net/*',
  '*://*.adzerk.net/*',
  '*://*.exponential.com/*',
  '*://*.flashtalking.com/*',
  '*://*.adform.net/*',
  '*://s.youtube.com/api/stats/ads*',
  '*://s.youtube.com/api/stats/qoe?*adformat*',
  '*://s.youtube.com/api/stats/watchtime?*adformat*',
  '*://*.youtube.com/api/stats/qoe?*adformat*',
  '*://*.youtube.com/api/stats/watchtime?*adformat*',
];

interface BetterWebRequestAlias {
  onBeforeRequest(
    filter: { urls: string[] },
    listener: (
      details: Electron.OnBeforeRequestListenerDetails,
      callback: (response: Electron.CallbackResponse) => void,
    ) => void,
  ): { id: string };
  onBeforeSendHeaders(
    listener: (
      details: Electron.OnBeforeSendHeadersListenerDetails,
      callback: (response: Electron.BeforeSendResponse) => void,
    ) => void,
  ): { id: string };
}

export const loadOmniblockEngine = async (
  session?: Electron.Session,
  cache = true,
) => {
  const betterSession = session as BetterSession | undefined;
  const cacheDirectory = path.join(app.getPath('userData'), 'omniblock_cache');
  if (!fs.existsSync(cacheDirectory)) {
    fs.mkdirSync(cacheDirectory, { recursive: true });
  }
  const cachingOptions = cache
    ? {
      path: path.join(cacheDirectory, 'engine.bin'),
      read: promises.readFile,
      write: promises.writeFile,
    }
    : undefined;

  try {
    if (!blocker) {
      if (!loadingBlocker) {
        loadingBlocker = ElectronBlocker.fromLists(
          (url: string) => net.fetch(url),
          BLACKLISTS,
          {
            enableCompression: true,
            loadNetworkFilters: betterSession !== undefined,
            loadCosmeticFilters: betterSession !== undefined,
          },
          cachingOptions,
        );
      }
      try {
        blocker = await loadingBlocker;
      } catch (err) {
        loadingBlocker = undefined;
        throw err;
      }
    }

    if (betterSession) {
      blocker.enableBlockingInSession(betterSession);

      if (onBeforeRequestListenerId) {
        betterSession.webRequest.removeListener(
          'onBeforeRequest',
          onBeforeRequestListenerId,
        );
        onBeforeRequestListenerId = undefined;
      }
      if (onBeforeSendHeadersListenerId) {
        betterSession.webRequest.removeListener(
          'onBeforeSendHeaders',
          onBeforeSendHeadersListenerId,
        );
        onBeforeSendHeadersListenerId = undefined;
      }

      const webRequest = betterSession.webRequest as unknown as BetterWebRequestAlias;

      const onBeforeRequestListener = webRequest.onBeforeRequest(
        { urls: KNOWN_AD_PATTERNS },
        (_, callback) => {
          callback({ cancel: true });
        },
      );
      onBeforeRequestListenerId = onBeforeRequestListener?.id;

      const onBeforeSendHeadersListener =
        webRequest.onBeforeSendHeaders((details, callback) => {
          const url = details.url;
          if (
            url.includes('doubleclick') ||
            url.includes('googlesyndication') ||
            url.includes('googleadservices')
          ) {
            callback({ cancel: true });
          } else {
            callback({ requestHeaders: details.requestHeaders });
          }
        });
      onBeforeSendHeadersListenerId = onBeforeSendHeadersListener?.id;
    }
  } catch (error) {
    console.error('Omniblock engine failed to load:', error);
  }
};

export const unloadOmniblockEngine = (session: Electron.Session) => {
  const betterSession = session as BetterSession;
  if (blocker) {
    blocker.disableBlockingInSession(betterSession);
  }
  if (onBeforeRequestListenerId) {
    betterSession.webRequest.removeListener(
      'onBeforeRequest',
      onBeforeRequestListenerId,
    );
    onBeforeRequestListenerId = undefined;
  }
  if (onBeforeSendHeadersListenerId) {
    betterSession.webRequest.removeListener(
      'onBeforeSendHeaders',
      onBeforeSendHeadersListenerId,
    );
    onBeforeSendHeadersListenerId = undefined;
  }
};

export const isOmniblockEnabled = (session: Electron.Session) =>
  blocker !== undefined && blocker.isBlockingEnabled(session);