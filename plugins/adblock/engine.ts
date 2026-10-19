// Ghostery's filter engine, built from filter lists once and cached on disk:
// later launches deserialize it in milliseconds and refresh it in the background.
//
// @ghostery/adblocker-electron resolves its cosmetic-filter preload when the
// module loads, which fails inside Pear Desktop's bundled main process (and Pear Desktop's
// sandboxed window couldn't run that preload anyway). Network blocking is all
// we use, so the engine is wired to the plugin's scoped webRequest here.

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { adsAndTrackingLists, FiltersEngine, Request } from "@ghostery/adblocker";
import { net, type WebRequest } from "electron";

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const CSP_HEADER = "content-security-policy";

export interface EngineOptions {
  defaultLists: boolean;
  extraLists: readonly string[];
  /** Directory for the cache; undefined disables caching. */
  cacheDir: string | undefined;
}

export interface LoadedEngine {
  engine: FiltersEngine;
  /** Resolves with a fresher engine when the cached one was stale, else undefined. */
  refreshed: Promise<FiltersEngine | undefined>;
}

/** Splits a free-form list of URLs (spaces, commas or newlines). */
export function parseListUrls(text: string) {
  return text.split(/[\s,]+/).filter((s) => URL.canParse(s));
}

function build(lists: readonly string[]) {
  // Network filters only: cosmetic filters bring YT scriptlets (json-prune
  // of ad placements) that desync the player and cut the start of tracks.
  return FiltersEngine.fromLists((url) => net.fetch(url), [...lists], {
    enableCompression: true,
    loadCosmeticFilters: false,
    loadNetworkFilters: true,
  });
}

async function save(file: string, engine: FiltersEngine) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, engine.serialize());
  await rename(`${file}.tmp`, file);
}

export async function loadEngine(options: EngineOptions): Promise<LoadedEngine> {
  const lists = [...(options.defaultLists ? adsAndTrackingLists : []), ...options.extraLists];
  if (lists.length === 0) throw new Error("No filter lists: enable the default lists or add your own.");
  if (!options.cacheDir) return { engine: await build(lists), refreshed: Promise.resolve(undefined) };

  const key = createHash("sha256").update(lists.join("\n")).digest("hex").slice(0, 12);
  const file = join(options.cacheDir, `engine-${key}.bin`);
  try {
    const [buffer, info] = await Promise.all([readFile(file), stat(file)]);
    const engine = FiltersEngine.deserialize(buffer);
    const stale = Date.now() - info.mtimeMs > MAX_AGE_MS;
    const refreshed = stale
      ? build(lists).then(async (fresh) => (await save(file, fresh), fresh))
      : Promise.resolve(undefined);
    return { engine, refreshed };
  } catch {
    // Missing, corrupt or from another engine version: rebuild.
    const engine = await build(lists);
    await save(file, engine).catch(() => {});
    return { engine, refreshed: Promise.resolve(undefined) };
  }
}

function toRequest(details: Electron.OnBeforeRequestListenerDetails | Electron.OnHeadersReceivedListenerDetails) {
  return Request.fromRawDetails({
    requestId: String(details.id),
    url: details.url,
    sourceUrl: details.referrer || details.webContents?.getURL() || "",
    type: (details.resourceType || "other") as never,
    ...(details.webContentsId === undefined ? {} : { tabId: details.webContentsId }),
  });
}

/** Routes requests through `getEngine()`; the listeners compose with everyone else's on the scoped webRequest. */
export function enableBlocking(webRequest: WebRequest, getEngine: () => FiltersEngine, onBlocked: () => void) {
  webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, callback) => {
    const request = toRequest(details);
    if (request.isMainFrame()) return callback({});
    const { redirect, match } = getEngine().match(request);
    if (redirect || match) onBlocked();
    if (redirect) callback({ redirectURL: redirect.dataUrl });
    else if (match) callback({ cancel: true });
    else callback({});
  });
  // $csp filters add policies to documents (merged with what earlier listeners left).
  webRequest.onHeadersReceived({ urls: ["<all_urls>"] }, (details, callback) => {
    if (details.resourceType !== "mainFrame" && details.resourceType !== "subFrame") return callback({});
    const directives = getEngine().getCSPDirectives(toRequest(details));
    if (!directives) return callback({});
    const headers = { ...details.responseHeaders };
    const policies = [directives];
    for (const name of Object.keys(headers)) {
      if (name.toLowerCase() !== CSP_HEADER) continue;
      policies.push(...headers[name]!);
      delete headers[name];
    }
    headers[CSP_HEADER] = [policies.join("; ")];
    callback({ responseHeaders: headers });
  });
}
