import { createHash } from 'node:crypto';
import fs, { promises } from 'node:fs';
import path from 'node:path';

import {
  ElectronBlocker,
  fromElectronDetails,
} from '@ghostery/adblocker-electron';
import { app, ipcMain, net } from 'electron';
import * as z from 'zod';

import { installCosmeticInjection } from './cosmetics';

let blocker: ElectronBlocker | undefined;
let disposeCosmetics: (() => void) | undefined;
let loadGeneration = 0;
let activeSession: Electron.Session | undefined;
let ownedPreloadIds: string[] = [];
let hasIdleCosmeticHandlers = false;

const removeCosmeticHandlers = () => {
  ipcMain.removeHandler('@ghostery/adblocker/inject-cosmetic-filters');
  ipcMain.removeHandler('@ghostery/adblocker/is-mutation-observer-enabled');
  hasIdleCosmeticHandlers = false;
};

const TbSourcesSchema = z.object({
  tb: z.array(z.string()),
});

const utmParameters = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_id',
  'utm_term',
  'utm_content',
  'utm_source_platform',
  'utm_creative_format',
  'utm_marketing_tactic',
];

const normalizeBlockList = (contents: string) =>
  contents
    .split('\n')
    .flatMap((line) => {
      const rule = line.trim();

      // Ghostery does not support regex $removeparam filters. Expand the
      // conventional uBO global UTM rule to its commonly used parameter names.
      if (rule === '$removeparam=/^utm_/') {
        return utmParameters.map((parameter) => `*$removeparam=${parameter}`);
      }

      // Ghostery requires a URL pattern before $removeparam. A leading `*`
      // preserves the global semantics of a bare uBO $removeparam rule.
      return rule.startsWith('$removeparam=') ? `*${rule}` : line;
    })
    .join('\n');

export const getLocalBlockListNames = async () => {
  const directory = path.join(app.getPath('userData'), 'blocklists');

  try {
    await promises.mkdir(directory, { recursive: true });
    const entries = await promises.readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  } catch (error) {
    console.error(`Error loading local blocklists from: ${directory}`, error);
    return [];
  }
};

const loadLocalBlockLists = async (disabledFiles: string[] = []) => {
  const directory = path.join(app.getPath('userData'), 'blocklists');
  const lists = new Map<string, string>();
  const disabled = new Set(disabledFiles);

  for (const [index, name] of (await getLocalBlockListNames())
    .filter((name) => !disabled.has(name))
    .entries()) {
    const file = path.join(directory, name);
    try {
      lists.set(
        `local-blocklist://${index}`,
        normalizeBlockList(await promises.readFile(file, 'utf8')),
      );
    } catch (error) {
      console.error(`Error reading blocklist file: ${file}`, error);
    }
  }
  return lists;
};

export const loadTrackerBlockerEngine = async (
  session?: Electron.Session,
  cache: boolean = true,
  additionalBlockLists: string[] = [],
  presetBlockLists: string[] = [],
  additionalBlockListRules: string[] = [],
  disableDefaultLists: boolean | unknown[] = false,
  loadCustomBlockLists: boolean = true,
  disabledLocalBlockLists: string[] = [],
) => {
  const generation = ++loadGeneration;
  const localLists = loadCustomBlockLists
    ? await loadLocalBlockLists(disabledLocalBlockLists)
    : new Map<string, string>();

  for (const [index, contents] of presetBlockLists.entries()) {
    localLists.set(
      `builtin-blocklist://${index}`,
      normalizeBlockList(contents),
    );
  }

  if (loadCustomBlockLists && additionalBlockListRules.length > 0) {
    localLists.set(
      'local-blocklist://inline-rules',
      normalizeBlockList(additionalBlockListRules.join('\n')),
    );
  }

  // Remote lists may change without their URL changing. Local and inline lists
  // use a content-addressed cache, so restarts remain fast without serving
  // stale user rules.
  const cacheDirectory = path.join(app.getPath('userData'), 'tb_cache');
  if (!fs.existsSync(cacheDirectory)) {
    fs.mkdirSync(cacheDirectory);
  }
  const localListHash = createHash('sha256')
    .update([...localLists.values()].join('\0'))
    .digest('hex');
  const cachingOptions =
    cache && additionalBlockLists.length === 0
      ? {
          path: path.join(
            cacheDirectory,
            localLists.size === 0
              ? 'tb-engine.bin'
              : `tb-engine-${localListHash}.bin`,
          ),
          read: promises.readFile,
          write: promises.writeFile,
        }
      : undefined;
  const defaultListsDisabled =
    (disableDefaultLists && !Array.isArray(disableDefaultLists)) ||
    (Array.isArray(disableDefaultLists) && disableDefaultLists.length > 0);
  let defaultLists: string[] = [];

  if (!defaultListsDisabled) {
    try {
      const tbSources = TbSourcesSchema.safeParse(
        await (
          await net.fetch(
            'https://raw.githubusercontent.com/organization/tb-list/refs/heads/main/tb.json',
          )
        ).json(),
      );
      defaultLists = tbSources.success ? tbSources.data.tb : [];
    } catch (error) {
      console.error('Error loading default blocklists', error);
    }
  }
  const lists = [
    ...defaultLists,
    ...additionalBlockLists,
    ...localLists.keys(),
  ];

  try {
    const engine = await ElectronBlocker.fromLists(
      async (url: string) => {
        const contents = localLists.get(url);
        return contents === undefined ? net.fetch(url) : new Response(contents);
      },
      lists,
      {
        enableCompression: true,
        // When generating the engine for caching, do not load network filters
        // So that enhancing the session works as expected
        // Allowing to define multiple webRequest listeners
        loadNetworkFilters: session !== undefined,
      },
      cachingOptions,
    );
    if (generation !== loadGeneration) return;
    disposeCosmetics = installCosmeticInjection(engine);
    blocker = engine;
    if (session) {
      activeSession = session;
      if (hasIdleCosmeticHandlers) removeCosmeticHandlers();
      const previousPreloads = new Set(
        session.getPreloadScripts().map(({ id }) => id),
      );
      try {
        engine.enableBlockingInSession(session);
      } finally {
        ownedPreloadIds = session
          .getPreloadScripts()
          .map(({ id }) => id)
          .filter((id) => !previousPreloads.has(id));
      }
      // @ghostery/adblocker-electron applies blocking and resource redirects,
      // but currently drops the engine's URL rewrites. Registering this after
      // enableBlockingInSession replaces its sole Electron listener while
      // retaining its cosmetic-filter preload and CSP handling.
      session.webRequest.onBeforeRequest(
        { urls: ['<all_urls>'] },
        (details, callback) => {
          const request = fromElectronDetails(details);
          const { match, redirect, rewrite } = engine.match(request);
          callback(
            request.isMainFrame()
              ? rewrite
                ? { redirectURL: rewrite.url }
                : {}
              : redirect
                ? { redirectURL: redirect.dataUrl }
                : rewrite
                  ? { redirectURL: rewrite.url }
                  : match
                    ? { cancel: true }
                    : {},
          );
        },
      );
    }
  } catch (error) {
    if (generation === loadGeneration && session && blocker)
      unloadTrackerBlockerEngine(session);
    console.error('Error loading blocker engine', error);
  }
};

export const unloadTrackerBlockerEngine = (
  session: Electron.Session,
  keepPageHandlers = false,
) => {
  if (activeSession && activeSession !== session) return;
  ++loadGeneration;
  disposeCosmetics?.();
  disposeCosmetics = undefined;
  if (blocker) {
    // Electron 42 no longer accepts `webRequest.onBeforeRequest(null)`, which
    // @ghostery/adblocker-electron still calls during disable. Replace the two
    // singleton listeners with inert callbacks and release its IPC/preload
    // resources ourselves, otherwise a profile reload leaks handlers.
    session.webRequest.onBeforeRequest(
      { urls: ['<all_urls>'] },
      (_details, callback) => callback({}),
    );
    session.webRequest.onHeadersReceived(
      { urls: ['<all_urls>'] },
      (_details, callback) => callback({}),
    );
    for (const id of ownedPreloadIds) {
      session.unregisterPreloadScript(id);
    }
    removeCosmeticHandlers();
    if (keepPageHandlers) {
      // "Later" leaves the old page alive. Its observer must not invoke
      // missing handlers while Lite is active; these perform no filtering.
      ipcMain.handle(
        '@ghostery/adblocker/inject-cosmetic-filters',
        () => undefined,
      );
      ipcMain.handle(
        '@ghostery/adblocker/is-mutation-observer-enabled',
        () => false,
      );
      hasIdleCosmeticHandlers = true;
    }
    blocker = undefined;
    activeSession = undefined;
    ownedPreloadIds = [];
  }
  if (!keepPageHandlers && hasIdleCosmeticHandlers) removeCosmeticHandlers();
};

export const isBlockerEnabled = (session: Electron.Session) =>
  blocker !== undefined && blocker.isBlockingEnabled(session);
