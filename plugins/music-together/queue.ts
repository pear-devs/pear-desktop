// pear-desktop's shared queue: YTM's own queue store is the session's queue.
// Its dispatch is wrapped, so changes made in YTM (play next, add to queue,
// remove, reorder, play) go to the session instead, and the session's changes
// are dispatched into it; each item shows who added it.

import { type ConnectionEventUnion, getDefaultProfile, type Profile, type VideoData } from "./types.ts";

type Translate = (key: string, fallback: string, vars?: Record<string, unknown>) => string;

interface VideoRenderer {
  videoId: string;
  selected?: boolean;
}

/** An item of YTM's queue state: a video, or a wrapper with the video as its primary renderer. */
export type QueueItem =
  | { playlistPanelVideoRenderer: VideoRenderer }
  | { playlistPanelVideoWrapperRenderer: { primaryRenderer: Record<string, VideoRenderer> } };

export interface StoreEvent {
  type: string;
  payload?: unknown;
}

interface QueueState {
  queue: { items: QueueItem[]; queueContextParams: string; nextQueueItemId: number };
}

interface Store {
  getState(): QueueState;
  dispatch(event: StoreEvent): void;
}

/** YTM's #queue element. */
export interface QueueElement extends HTMLElement {
  queue: { store: { store: Store } };
  dispatch(event: StoreEvent): void;
}

interface AppElement extends HTMLElement {
  networkManager: { fetch<T>(path: string, body: unknown): Promise<T> };
}

export type QueueEventListener = (event: ConnectionEventUnion) => void;

export const mapQueueItem = <T>(map: (item?: VideoRenderer) => T, items: readonly QueueItem[]): T[] =>
  items
    .map((item) => {
      if ("playlistPanelVideoWrapperRenderer" in item) {
        const primary = item.playlistPanelVideoWrapperRenderer.primaryRenderer;
        return primary[Object.keys(primary)[0]!];
      }
      if ("playlistPanelVideoRenderer" in item) return item.playlistPanelVideoRenderer;
      return undefined;
    })
    .map(map);

/** YTM's queue entries for these videos, from its own API. */
async function queueRenderers(queue: QueueElement, videoIds: string[]) {
  const app = document.querySelector<AppElement>("ytmusic-app");
  if (!app?.networkManager) return null;
  const response = await app.networkManager.fetch<{ queueDatas: { content: unknown }[] }>("/music/get_queue", {
    queueContextParams: queue.queue.store.store.getState().queue.queueContextParams,
    videoIds,
  });
  return response?.queueDatas.map((data) => data?.content).filter(Boolean) ?? null;
}

export interface QueueOptions {
  queue: QueueElement;
  getProfile(id: string): Profile | undefined;
  t: Translate;
}

export class Queue {
  private readonly queue: QueueElement;
  private originalDispatch: Store["dispatch"] | undefined;
  private internalDispatch = false;
  private ignoreFlag = false;
  private listeners: QueueEventListener[] = [];
  private owner: Profile | null = null;
  private readonly getProfile: (id: string) => Profile | undefined;
  private readonly t: Translate;
  private _videoList: VideoData[] = [];

  constructor(options: QueueOptions) {
    this.queue = options.queue;
    this.getProfile = options.getProfile;
    this.t = options.t;
  }

  get videoList() {
    return this._videoList;
  }

  private get store() {
    return this.queue.queue.store.store;
  }

  get selectedIndex() {
    return mapQueueItem((item) => item?.selected, this.store.getState().queue.items).findIndex(Boolean);
  }

  get flatItems() {
    return mapQueueItem((item) => item, this.store.getState().queue.items);
  }

  setOwner(owner: Profile) {
    this.owner = owner;
  }

  async setVideoList(videoList: VideoData[], sync = true) {
    this._videoList = videoList;
    if (sync) await this.syncVideo();
  }

  async addVideos(videos: VideoData[], index?: number) {
    const items = await queueRenderers(
      this.queue,
      videos.map((video) => video.videoId),
    );
    if (!items) return false;
    this.internalDispatch = true;
    const state = this.store.getState();
    this.queue.dispatch({
      type: "ADD_ITEMS",
      payload: {
        nextQueueItemId: state.queue.nextQueueItemId,
        index: index ?? (state.queue.items.length ? state.queue.items.length - 1 : null) ?? 0,
        items,
        shuffleEnabled: false,
        shouldAssignIds: true,
      },
    });
    const at = index ?? this._videoList.length;
    const inserted = this._videoList[at];
    if (!inserted || (inserted.videoId !== videos[0]?.videoId && inserted.ownerId !== videos[0]?.ownerId)) {
      this._videoList.splice(at, 0, ...videos.map((video) => ({ ...video, ownerId: video.ownerId ?? this.owner?.id })));
    }
    this.internalDispatch = false;
    this.refresh();
    return true;
  }

  removeVideo(index: number) {
    this.internalDispatch = true;
    this._videoList.splice(index, 1);
    this.queue.dispatch({ type: "REMOVE_ITEM", payload: index });
    this.internalDispatch = false;
    this.refresh();
  }

  setIndex(index: number) {
    this.internalDispatch = true;
    this.queue.dispatch({ type: "SET_INDEX", payload: index });
    this.internalDispatch = false;
  }

  moveItem(fromIndex: number, toIndex: number) {
    this.internalDispatch = true;
    const [moved] = this._videoList.splice(fromIndex, 1);
    if (moved) this._videoList.splice(toIndex, 0, moved);
    this.queue.dispatch({ type: "MOVE_ITEM", payload: { fromIndex, toIndex } });
    this.internalDispatch = false;
    this.refresh();
  }

  clear() {
    this.internalDispatch = true;
    this._videoList = [];
    this.queue.dispatch({ type: "CLEAR" });
    this.internalDispatch = false;
  }

  on(listener: QueueEventListener) {
    if (!this.listeners.includes(listener)) this.listeners.push(listener);
  }

  off(listener: QueueEventListener) {
    this.listeners = this.listeners.filter((it) => it !== listener);
  }

  rollbackInjection() {
    if (this.originalDispatch) this.store.dispatch = this.originalDispatch;
    this.originalDispatch = undefined;
  }

  /** Routes YTM's own queue changes to the session (see the file comment). */
  injection() {
    if (this.originalDispatch) return;
    const original = this.store.dispatch;
    this.originalDispatch = original;
    const store = this.store;
    store.dispatch = (event) => {
      if (!this.owner) return original.call(store, event);
      if (!this.internalDispatch) {
        const payload = event.payload as { items?: QueueItem[]; index?: number; fromIndex?: number; toIndex?: number } | undefined;
        const own = (items: QueueItem[]) =>
          mapQueueItem((it) => ({ videoId: it!.videoId, ownerId: this.owner!.id }) satisfies VideoData, items);
        switch (event.type) {
          case "CLEAR":
            this.ignoreFlag = true;
            return this.broadcast({ type: "CLEAR_QUEUE", payload: null });
          case "ADD_ITEMS": {
            if (this.ignoreFlag) {
              // Playing something new: YTM clears the queue, then adds the new one.
              this.ignoreFlag = false;
              const videoList = own(payload?.items ?? []);
              const index = this._videoList.length;
              if (videoList.length > 0) {
                this._videoList = [...videoList];
                this.broadcast({ type: "ADD_SONGS", payload: { videoList }, after: [{ type: "SET_INDEX", payload: { index } }] });
              }
            } else if (payload?.items?.length === 1) {
              // Play next / add to queue.
              const videoList = own(payload.items);
              const hasIndex = payload && Object.hasOwn(payload, "index");
              this._videoList.splice(hasIndex ? payload.index! : this._videoList.length, 0, ...videoList);
              this.broadcast({ type: "ADD_SONGS", payload: { ...(hasIndex ? { index: payload.index! } : {}), videoList } });
            }
            return;
          }
          case "MOVE_ITEM":
            return this.broadcast({ type: "MOVE_SONG", payload: { fromIndex: payload!.fromIndex!, toIndex: payload!.toIndex! } });
          case "REMOVE_ITEM":
            return this.broadcast({ type: "REMOVE_SONG", payload: { index: event.payload as number } });
          case "SET_INDEX":
            return this.broadcast({ type: "SYNC_PROGRESS", payload: { index: event.payload as number } });
          case "SET_HEADER":
            event.payload = this.headerPayload();
            break;
          case "ADD_STEERING_CHIPS":
            event.type = "CLEAR_STEERING_CHIPS";
            event.payload = undefined;
            break;
          case "SET_PLAYER_UI_STATE":
            if (event.payload === "INACTIVE" && this._videoList.length > 0) return;
            break;
          // No autoplay or automix in a session: the queue is what people put in it.
          case "HAS_SHOWN_AUTOPLAY":
          case "ADD_AUTOMIX_ITEMS":
            return;
        }
      }
      original.call(store, event);
    };
  }

  /** The queue's header says it's the session's, and autoplay is off. */
  initQueue() {
    this.internalDispatch = true;
    this.queue.dispatch({ type: "HAS_SHOWN_AUTOPLAY", payload: false });
    this.queue.dispatch({ type: "SET_HEADER", payload: this.headerPayload() });
    this.queue.dispatch({ type: "CLEAR_STEERING_CHIPS" });
    this.internalDispatch = false;
  }

  async syncVideo() {
    const items = await queueRenderers(
      this.queue,
      this._videoList.map((video) => video.videoId),
    );
    if (!items) return false;
    this.internalDispatch = true;
    this.queue.dispatch({
      type: "UPDATE_ITEMS",
      payload: { items, nextQueueItemId: this.store.getState().queue.nextQueueItemId, shouldAssignIds: true, currentIndex: -1 },
    });
    this.internalDispatch = false;
    this.refresh();
    return true;
  }

  /** Shows who added each item: their avatar, and their name on hover. */
  syncQueueOwner() {
    for (const queue of document.querySelectorAll("#queue")) {
      const items = queue.querySelectorAll<HTMLElement>(
        "#contents > ytmusic-player-queue-item, #contents > ytmusic-playlist-panel-video-wrapper-renderer > #primary-renderer > ytmusic-player-queue-item",
      );
      items.forEach((item, index) => {
        const id = this._videoList[index]?.ownerId ?? "";
        let data = this.getProfile(id);
        const avatar = item.querySelector<HTMLImageElement>(".music-together-owner") ?? document.createElement("img");
        avatar.classList.add("music-together-owner");
        avatar.dataset.id = id;
        avatar.dataset.index = String(index);
        const name = item.querySelector<HTMLElement>(".music-together-name") ?? document.createElement("div");
        name.classList.add("music-together-name");
        name.textContent = data?.name ?? this.t("plugins.music-together.internal.unknown-user", "Unknown User");
        if (!data?.name && !data?.handleId) data = getDefaultProfile(data?.id ?? "");
        avatar.src = data.thumbnail;
        avatar.title = data.name;
        avatar.alt = data.handleId;
        if (!avatar.isConnected) item.append(avatar);
        if (!name.isConnected) item.append(name);
      });
    }
  }

  removeQueueOwner() {
    for (const element of document.querySelectorAll("#queue .music-together-owner, #queue .music-together-name")) element.remove();
  }

  private refresh() {
    setTimeout(() => {
      this.initQueue();
      this.syncQueueOwner();
    }, 0);
  }

  private headerPayload() {
    const save = this.t("plugins.music-together.internal.save", "Save");
    return {
      title: { runs: [{ text: this.t("plugins.music-together.internal.track-source", "Track Source") }] },
      subtitle: { runs: [{ text: this.t("plugins.music-together.name", "Music Together") }] },
      buttons: [
        {
          chipCloudChipRenderer: {
            style: { styleType: "STYLE_TRANSPARENT" },
            text: { runs: [{ text: save }] },
            navigationEndpoint: { saveQueueToPlaylistCommand: {} },
            icon: { iconType: "ADD_TO_PLAYLIST" },
            accessibilityData: { accessibilityData: { label: save } },
            isSelected: false,
            uniqueId: save,
          },
        },
      ],
    };
  }

  private broadcast(event: ConnectionEventUnion) {
    for (const listener of this.listeners) listener(event);
  }
}
