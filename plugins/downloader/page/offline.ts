// Offline playback in the site's own UI (page only). The songs the host kept
// (offline.ts), and the albums and playlists they came from, are written into
// the site's offline databases, which its Downloads page and player read, so
// they play there without internet.
// Deleting one in that page deletes our copy as well, and the site's download
// buttons, when it shows them, queue a download here instead of its own (which
// the host stops, see blockOfflineSync).

import { remoteErrorMessage } from "@pear/sdk/util";
import type { OfflineData, OfflineList, OfflineTrack } from "../offline.ts";
import {
  AUDIO_ONLY,
  CHUNK_BYTES,
  chunkKey,
  type EntityRecord,
  type EntityType,
  entityKey,
  indexEntry,
  indexKey,
  LIST_ENTITIES,
  libraryKey,
  listEntities,
  policyRecord,
  SONG_ENTITIES,
  songEntities,
  songKey,
} from "./offline-records.ts";
import { type StartDownload, targetLabel } from "./options.ts";
import type { Ctx } from "./types.ts";

const ENTITY_DB = "PersistentEntityStoreDb";
const MEDIA_DB = "yt-player-local-media";
/** The versions the site creates them at, should they not be there yet. */
const ENTITY_DB_VERSION = 3;
const MEDIA_DB_VERSION = 5;

/** The Library page's id, and its Downloads tab, as the site adds it itself. */
const LIBRARY_PAGE = "FEmusic_library_landing";
const DOWNLOADS_TAB = {
  tabRenderer: { title: "Downloads", selected: false, endpoint: { browseEndpoint: { browseId: "FEmusic_offline" } }, targetId: "music-downloads-tab" },
};
/** How long the Library tab waits for the browse page's data after a navigation. */
const PAGE_DATA_WAIT_MS = 5000;
const PAGE_DATA_POLL_MS = 100;

interface BrowseData {
  contents?: { singleColumnBrowseResultsRenderer?: { tabs?: unknown[] } };
}

/** A command of the site's, as its elements send them up the page (`yt-action`). */
interface SiteAction {
  actionName?: string;
  args?: [Record<string, { videoId?: string; playlistId?: string; action?: string; targetId?: string } | undefined>?];
}

declare global {
  interface Window {
    yt?: { config_?: { DATASYNC_ID?: string; LOGGED_IN?: boolean } };
  }
}

/** A change to the site's app state, as its own reducers take them. */
interface StateAction {
  type: string;
  payload?: unknown;
}

export function startOffline(ctx: Ctx, startDownload: StartDownload) {
  if (!ctx.config.offline) return;
  const kept = new Set<string>();
  const keptLists = new Set<string>();
  // The Library's Downloads tab shows once there are downloads.
  const showLibraryTab = libraryTab(ctx, () => kept.size > 0);
  const site = (async () => {
    await ctx.waitFor("app");
    const config = window.yt?.config_;
    const account = config?.DATASYNC_ID;
    if (!account) throw new Error("the site has no offline storage for this account");
    // Signed out, the site never loads its offline database into its app state, so
    // its Downloads page shows nothing: the database is mirrored there from here.
    const app = config?.LOGGED_IN ? undefined : ctx.$<HTMLElement & { dispatch?(action: StateAction): void }>("app");
    return new OfflineSite(account, app?.dispatch ? (action) => app.dispatch!(action) : undefined);
  })();

  const failed = (what: string) => (error: unknown) => ctx.log.warn(`offline playback: ${what}:`, remoteErrorMessage(error));
  site.catch(failed("starting"));
  ctx.onCleanup(() => void site.then((stores) => stores.close(), () => {}));
  const add = async (videoId: string) => {
    const data = await ctx.host.invoke("offlineTrack", videoId);
    if (!data) return;
    await (await site).write(data);
    kept.add(videoId);
    showLibraryTab();
  };
  const remove = async (videoId: string) => {
    kept.delete(videoId);
    await ctx.host.invoke("offlineRemove", videoId);
    // The site deletes its own records; this is in case it didn't get to all of them.
    await (await site).remove(videoId);
    // It is off the lists it was on.
    await syncLists();
  };
  /** An album or playlist, with its songs no other list has. */
  const removeList = async (playlistId: string) => {
    const songs = await ctx.host.invoke("offlineRemoveList", playlistId);
    const stores = await site;
    for (const videoId of songs) {
      kept.delete(videoId);
      await stores.remove(videoId);
    }
    await syncLists();
  };
  // The lists as the host has them; those it no longer has go.
  const syncLists = async () => {
    const lists = await ctx.host.invoke("offlineLists");
    const gone = [...keptLists].filter((playlistId) => !lists.some((list) => list.playlistId === playlistId));
    await (await site).writeLists(lists, gone);
    keptLists.clear();
    for (const list of lists) keptLists.add(list.playlistId);
  };

  // Songs missing from the site's databases (a new account, cleared site data, the
  // site removing them) are written again; the others get their policy renewed.
  const sync = async () => {
    const tracks = await ctx.host.invoke("offlineTracks");
    const stores = await site;
    for (const track of tracks) {
      try {
        if (await stores.has(track)) await stores.renew(track.videoId);
        else await add(track.videoId);
        kept.add(track.videoId);
      } catch (error) {
        failed(track.title)(error);
      }
    }
  };
  void sync()
    .then(syncLists)
    .then(async () => (await site).mirror())
    .then(showLibraryTab, failed("sync"));
  ctx.host.on("offline-added", (videoId) => void add(String(videoId)).catch(failed(String(videoId))));
  ctx.host.on("offline-lists-changed", () => void syncLists().catch(failed("lists")));

  // The site's own download commands. It deletes its records of a song itself (its
  // database work needs no server), so a deleted song only goes from ours.
  ctx.listen(
    document,
    "yt-action",
    (event: CustomEvent<SiteAction>) => {
      const { actionName, args } = event.detail ?? {};
      const command = args?.[0];
      const video = command?.offlineVideoEndpoint;
      const playlist = command?.offlinePlaylistEndpoint;
      if (video?.action === "ACTION_ADD" && video.videoId) {
        event.stopImmediatePropagation();
        const target = { videoId: video.videoId };
        startDownload(target, targetLabel(ctx, target));
      } else if (playlist?.action === "ACTION_ADD" && playlist.playlistId) {
        event.stopImmediatePropagation();
        const target = { videoId: "", playlistId: playlist.playlistId };
        startDownload(target, targetLabel(ctx, target));
      } else if (actionName === "yt-signal-action-delete-download") {
        const videoId = command?.signalAction?.targetId;
        if (videoId && kept.has(videoId)) void remove(videoId).catch(failed(`deleting ${videoId}`));
      } else if (actionName === "yt-signal-action-delete-playlist-download") {
        const playlistId = command?.signalAction?.targetId;
        if (playlistId && keptLists.has(playlistId)) void removeList(playlistId).catch(failed(`deleting ${playlistId}`));
      } else if (actionName === "yt-signal-action-delete-all-downloads") {
        for (const videoId of [...kept]) void remove(videoId).catch(failed(`deleting ${videoId}`));
      }
    },
    { capture: true },
  );
}

/**
 * The Library's Downloads tab. The site adds it to the Library page itself, but
 * draws the tab bar only when the server's answer has more than one tab, as it
 * has for Premium accounts alone; with the tab in the answer, the bar shows.
 */
function libraryTab(ctx: Ctx, hasDownloads: () => boolean) {
  /** Whether there is nothing more to wait for: not the Library, or its data is drawn. */
  const addTab = () => {
    if (location.pathname !== "/library") return true;
    const page = ctx.$<HTMLElement & { data?: BrowseData }>("browse.response");
    const data = page?.data;
    const results = data?.contents?.singleColumnBrowseResultsRenderer;
    const tabs = results?.tabs ?? [];
    // Until the Library's own data replaced the last page's.
    if (!page || !results || !JSON.stringify(tabs).includes(LIBRARY_PAGE)) return false;
    if (tabs.length === 1 && hasDownloads()) {
      page.data = { ...data, contents: { ...data.contents, singleColumnBrowseResultsRenderer: { ...results, tabs: [...tabs, DOWNLOADS_TAB] } } };
    }
    return true;
  };
  let timer: ReturnType<typeof setInterval> | undefined;
  const whenDrawn = () => {
    ctx.clearInterval(timer);
    const until = Date.now() + PAGE_DATA_WAIT_MS;
    timer = ctx.setInterval(() => {
      if (addTab() || Date.now() > until) ctx.clearInterval(timer);
    }, PAGE_DATA_POLL_MS);
  };
  ctx.listen(navigation, "currententrychange", whenDrawn);
  whenDrawn();
  return whenDrawn;
}

/** The site's offline databases for one account, opened per use so they never hold up its own upgrades. */
class OfflineSite {
  readonly #account: string;
  readonly #channel: BroadcastChannel;
  /** Set when the site doesn't keep its app state in step with the database itself. */
  readonly #dispatch: ((action: StateAction) => void) | undefined;

  constructor(account: string, dispatch?: (action: StateAction) => void) {
    this.#account = account;
    this.#dispatch = dispatch;
    // The site's own tabs and its app state follow the entity store through this.
    this.#channel = new BroadcastChannel(`PERSISTENT_ENTITY_STORE_SYNC:${account}`);
  }

  close() {
    this.#channel.close();
  }

  /** Whether the song's stream and its playback entity are there. */
  async has(track: OfflineTrack) {
    const entry = await this.#media("readonly", (stores) => request<{ format?: { lastModified?: string } } | undefined>(stores.index.get(indexKey(track.videoId, "a"))));
    if (entry?.format?.lastModified !== track.format.lastModified) return false;
    const playback = await this.#entities("readonly", ({ entities }) => request(entities.getKey(songKey(track.videoId, "playbackData"))));
    return playback !== undefined;
  }

  async write({ track, playerResponse, audio }: OfflineData) {
    const { videoId, format } = track;
    if (audio.byteLength !== format.contentLength) throw new Error(`the kept stream has ${audio.byteLength} bytes, not ${format.contentLength}`);
    const now = Math.floor(Date.now() / 1000);
    const { entities, associations } = songEntities({ track, playerResponse }, now, `pear-${crypto.randomUUID()}`);
    const library = await this.#library();
    const trackKey = songKey(videoId, "musicTrack");
    const tracks = (Array.isArray(library.downloadedTracks) ? (library.downloadedTracks as string[]) : []).filter((key) => key !== trackKey);
    const libraryRecord: EntityRecord = { key: libraryKey(), entityType: "musicDownloadsLibraryEntity", data: { ...library, id: libraryKey(), downloadedTracks: [trackKey, ...tracks] }, version: 0 };

    await this.#media("readwrite", ({ index, media }) => {
      index.put(indexEntry(videoId, format), indexKey(videoId, "a"));
      index.put(AUDIO_ONLY, indexKey(videoId, "v"));
      for (let part = 0; part * CHUNK_BYTES < audio.byteLength; part++) {
        media.put(audio.slice(part * CHUNK_BYTES, (part + 1) * CHUNK_BYTES), chunkKey(videoId, format, part));
      }
    });
    await this.#entities("readwrite", ({ entities: store, associations: links }) => {
      for (const record of [...entities, libraryRecord]) store.put(record);
      for (const link of associations) links.put(link);
    });
    this.#markDownloaded(videoId, true);
    this.#announce([...entities, libraryRecord]);
  }

  /** Renews the song's policy, which the player checks before playing it offline. */
  async renew(videoId: string) {
    const record = policyRecord(videoId, Math.floor(Date.now() / 1000));
    await this.#entities("readwrite", ({ entities }) => entities.put(record));
    this.#markDownloaded(videoId, true);
    this.#announce([record]);
  }

  async remove(videoId: string) {
    const keys = SONG_ENTITIES.map((type) => songKey(videoId, type));
    const library = await this.#library();
    const trackKey = songKey(videoId, "musicTrack");
    const tracks = Array.isArray(library.downloadedTracks) ? (library.downloadedTracks as string[]) : [];
    const libraryRecord: EntityRecord = {
      key: libraryKey(),
      entityType: "musicDownloadsLibraryEntity",
      data: { ...library, id: libraryKey(), downloadedTracks: tracks.filter((key) => key !== trackKey) },
      version: 0,
    };
    await this.#entities("readwrite", ({ entities, associations }) => {
      for (const key of keys) {
        entities.delete(key);
        associations.index("byParentEntityKey").openKeyCursor(IDBKeyRange.only(key)).onsuccess = deleteEach(associations);
        associations.index("byChildEntityKey").openKeyCursor(IDBKeyRange.only(key)).onsuccess = deleteEach(associations);
      }
      entities.put(libraryRecord);
    });
    await this.#media("readwrite", ({ index, media }) => {
      index.delete(IDBKeyRange.bound(`${videoId}|`, `${videoId}~`));
      media.delete(IDBKeyRange.bound(`${videoId}|`, `${videoId}~`));
    });
    this.#markDownloaded(videoId, false);
    this.#announce([...SONG_ENTITIES.map((entityType): Pick<EntityRecord, "key" | "entityType"> => ({ key: songKey(videoId, entityType), entityType })), libraryRecord]);
  }

  /**
   * Writes the albums and playlists, and deletes those `gone`; the library
   * lists them (and keeps the site's own).
   */
  async writeLists(lists: readonly OfflineList[], gone: readonly string[]) {
    const library = await this.#library();
    const ours = new Set([...lists.map((list) => list.playlistId), ...gone].map((playlistId) => entityKey(playlistId, "musicPlaylist")));
    const theirs = (Array.isArray(library.downloadedPlaylists) ? (library.downloadedPlaylists as string[]) : []).filter((key) => !ours.has(key));
    const written = lists.map((list) => listEntities(list));
    const libraryRecord: EntityRecord = {
      key: libraryKey(),
      entityType: "musicDownloadsLibraryEntity",
      data: { ...library, id: libraryKey(), downloadedPlaylists: [...lists.map((list) => entityKey(list.playlistId, "musicPlaylist")), ...theirs] },
      version: 0,
    };
    const deleted = gone.flatMap((playlistId) => LIST_ENTITIES.map((entityType) => ({ key: entityKey(playlistId, entityType), entityType })));
    await this.#entities("readwrite", ({ entities, associations }) => {
      for (const { key } of deleted) {
        entities.delete(key);
        associations.index("byParentEntityKey").openKeyCursor(IDBKeyRange.only(key)).onsuccess = deleteEach(associations);
      }
      for (const { entities: records, associations: links } of written) {
        for (const record of records) entities.put(record);
        for (const link of links) associations.put(link);
      }
      entities.put(libraryRecord);
    });
    this.#announce([...written.flatMap(({ entities: records }) => records), ...deleted, libraryRecord]);
  }

  /** Puts every entity of the database into the site's app state, as the site does on load when signed in. */
  async mirror() {
    if (!this.#dispatch) return;
    const rows = await this.#entities("readonly", ({ entities }) => request<StoredEntity[]>(entities.getAll()));
    const state: Record<string, Record<string, unknown>> = {};
    for (const row of rows) (state[row.entityType] ??= {})[row.key] = await this.#decode(row);
    this.#dispatch({ type: "REPLACE_ENTITIES", payload: state });
  }

  /** The library entity's fields, decrypted when the site wrote it. */
  async #library(): Promise<Record<string, unknown>> {
    const row = await this.#entities("readonly", ({ entities }) => request<StoredEntity | undefined>(entities.get(libraryKey())));
    return row ? await this.#decode(row) : {};
  }

  /** The site encrypts entities (version 1) with AES-CTR: the account's id is the key, the entity's key the counter. */
  async #decode(row: StoredEntity): Promise<Record<string, unknown>> {
    if (row.version !== 1) return row.data as Record<string, unknown>;
    const key = await crypto.subtle.importKey("raw", first16(this.#account), { name: "AES-CTR" }, false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt({ name: "AES-CTR", counter: first16(row.key), length: 128 }, key, row.data as BufferSource);
    return JSON.parse(new TextDecoder().decode(plain)) as Record<string, unknown>;
  }

  /**
   * The player's own list of fully downloaded songs, which it checks before
   * reading a song from the media store.
   */
  #markDownloaded(videoId: string, downloaded: boolean) {
    const key = `${this.#account}::yt-player::yt-player-lv`;
    let marks: Record<string, number> = {};
    try {
      marks = JSON.parse((JSON.parse(localStorage.getItem(key) ?? "{}") as { data?: string }).data ?? "{}") as Record<string, number>;
    } catch {}
    if (downloaded) marks[videoId] = 1;
    else delete marks[videoId];
    localStorage.setItem(key, JSON.stringify({ data: JSON.stringify(marks), creation: Date.now() }));
  }

  /** Tells the site's app state which entities changed (records without data were deleted), as its own writes do. */
  #announce(records: (Pick<EntityRecord, "key" | "entityType"> & { data?: unknown })[]) {
    const changed: Partial<Record<EntityType, Set<string>>> = {};
    for (const { key, entityType } of records) (changed[entityType] ??= new Set()).add(key);
    this.#channel.postMessage(changed);
    if (!this.#dispatch) return;
    const state: Record<string, Record<string, unknown>> = {};
    for (const { key, entityType, data } of records) (state[entityType] ??= {})[key] = data;
    this.#dispatch({ type: "REPLACE_ENTITIES", payload: state });
  }

  #entities<T>(mode: IDBTransactionMode, run: (stores: { entities: IDBObjectStore; associations: IDBObjectStore }) => T | Promise<T>) {
    return transact(open(`${ENTITY_DB}:${this.#account}`, ENTITY_DB_VERSION, createEntityStores), ["EntityStore", "EntityAssociationStore"], mode, (tx) =>
      run({ entities: tx.objectStore("EntityStore"), associations: tx.objectStore("EntityAssociationStore") }),
    );
  }

  #media<T>(mode: IDBTransactionMode, run: (stores: { index: IDBObjectStore; media: IDBObjectStore }) => T | Promise<T>) {
    return transact(open(`${MEDIA_DB}:${this.#account}`, MEDIA_DB_VERSION, createMediaStores), ["index", "media"], mode, (tx) =>
      run({ index: tx.objectStore("index"), media: tx.objectStore("media") }),
    );
  }
}

interface StoredEntity {
  key: string;
  entityType: string;
  data: unknown;
  version: number;
}

function first16(text: string) {
  const bytes = new Uint8Array(16);
  bytes.set(new TextEncoder().encode(text).subarray(0, 16));
  return bytes;
}

/** The site's schema, for a database it hasn't created yet. */
function createEntityStores(db: IDBDatabase) {
  db.createObjectStore("EntityStore", { keyPath: "key" }).createIndex("entityType", "entityType");
  const associations = db.createObjectStore("EntityAssociationStore", { keyPath: ["parentEntityKey", "childEntityKey"] });
  associations.createIndex("byParentEntityKey", "parentEntityKey");
  associations.createIndex("byChildEntityKey", "childEntityKey");
}

function createMediaStores(db: IDBDatabase) {
  for (const name of ["index", "media", "captions"]) db.createObjectStore(name);
}

/** Opens the database as it is, or creates it at the site's version when it isn't there. */
async function open(name: string, version: number, create: (db: IDBDatabase) => void) {
  const exists = (await indexedDB.databases()).some((db) => db.name === name);
  const opening = exists ? indexedDB.open(name) : indexedDB.open(name, version);
  if (!exists) opening.onupgradeneeded = () => create(opening.result);
  const db = await request(opening);
  // The site upgrading its database waits for everyone else to close theirs.
  db.onversionchange = () => db.close();
  return db;
}

/** Runs `run` in a transaction and resolves with its result once the transaction completed. */
async function transact<T>(opening: Promise<IDBDatabase>, stores: string[], mode: IDBTransactionMode, run: (tx: IDBTransaction) => T | Promise<T>): Promise<T> {
  const db = await opening;
  try {
    const tx = db.transaction(stores, mode);
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
    });
    const result = await run(tx);
    await done;
    return result;
  } finally {
    db.close();
  }
}

function request<T>(req: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** A key cursor's handler that deletes every row it visits from `store`. */
const deleteEach = (store: IDBObjectStore) =>
  function (this: IDBRequest<IDBCursor | null>) {
    const cursor = this.result;
    if (!cursor) return;
    store.delete(cursor.primaryKey);
    cursor.continue();
  };
