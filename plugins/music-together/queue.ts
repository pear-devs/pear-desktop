// pear-desktop's shared queue: YTM's own queue store is the session's queue.
// Its dispatch is wrapped, so changes made in YTM (play next, add to queue,
// remove, reorder, play) go to the session instead, and the session's changes
// are dispatched into it; each item shows who added it.

import type { Translate } from "@pear/sdk/i18n";
import { decorateOwner } from "./owners.tsx";
import type { ConnectionEventUnion, Profile, VideoData } from "./types.ts";

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

type QueuePayload = { items?: QueueItem[]; index?: number; fromIndex?: number; toIndex?: number } | undefined;

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

// Queue rows, plain or inside a video wrapper.
const QUEUE_ITEMS =
  "#contents > ytmusic-player-queue-item, #contents > ytmusic-playlist-panel-video-wrapper-renderer > #primary-renderer > ytmusic-player-queue-item";

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
  /** Set while this class dispatches the session's changes, which mustn't loop back to it. */
  private applyingSession = false;
  /** YTM cleared the queue: the next ADD_ITEMS is a whole new queue (something new is playing). */
  private replacingQueue = false;
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
    const { queue } = this.store.getState();
    this.dispatchSession({
      type: "ADD_ITEMS",
      payload: {
        nextQueueItemId: queue.nextQueueItemId,
        index: index ?? Math.max(0, queue.items.length - 1),
        items,
        shuffleEnabled: false,
        shouldAssignIds: true,
      },
    });
    const at = index ?? this._videoList.length;
    const current = this._videoList[at];
    // Our own ADD_SONGS echoed back: the list already has them.
    const alreadyListed = current && (current.videoId === videos[0]?.videoId || current.ownerId === videos[0]?.ownerId);
    if (!alreadyListed) {
      const owned = videos.map((video) => ({ ...video, ownerId: video.ownerId ?? this.owner?.id }));
      this._videoList.splice(at, 0, ...owned);
    }
    this.refresh();
    return true;
  }

  removeVideo(index: number) {
    this._videoList.splice(index, 1);
    this.dispatchSession({ type: "REMOVE_ITEM", payload: index });
    this.refresh();
  }

  setIndex(index: number) {
    this.dispatchSession({ type: "SET_INDEX", payload: index });
  }

  moveItem(fromIndex: number, toIndex: number) {
    const [moved] = this._videoList.splice(fromIndex, 1);
    if (moved) this._videoList.splice(toIndex, 0, moved);
    this.dispatchSession({ type: "MOVE_ITEM", payload: { fromIndex, toIndex } });
    this.refresh();
  }

  clear() {
    this._videoList = [];
    this.dispatchSession({ type: "CLEAR" });
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
    const store = this.store;
    const original = store.dispatch;
    this.originalDispatch = original;
    store.dispatch = (event) => {
      const passOn = !this.owner || this.applyingSession || this.onYtmChange(event);
      if (passOn) original.call(store, event);
    };
  }

  /** A change YTM made itself; whether it should still reach YTM's store (possibly rewritten). */
  private onYtmChange(event: StoreEvent): boolean {
    const payload = event.payload as QueuePayload;
    switch (event.type) {
      case "CLEAR":
        this.replacingQueue = true;
        this.broadcast({ type: "CLEAR_QUEUE", payload: null });
        return false;
      case "ADD_ITEMS":
        this.onYtmAdd(payload);
        return false;
      case "MOVE_ITEM":
        this.broadcast({ type: "MOVE_SONG", payload: { fromIndex: payload!.fromIndex!, toIndex: payload!.toIndex! } });
        return false;
      case "REMOVE_ITEM":
        this.broadcast({ type: "REMOVE_SONG", payload: { index: event.payload as number } });
        return false;
      case "SET_INDEX":
        this.broadcast({ type: "SYNC_PROGRESS", payload: { index: event.payload as number } });
        return false;
      case "SET_HEADER":
        event.payload = this.headerPayload();
        return true;
      case "ADD_STEERING_CHIPS":
        event.type = "CLEAR_STEERING_CHIPS";
        event.payload = undefined;
        return true;
      case "SET_PLAYER_UI_STATE":
        return !(event.payload === "INACTIVE" && this._videoList.length > 0);
      // No autoplay or automix in a session: the queue is what people put in it.
      case "HAS_SHOWN_AUTOPLAY":
      case "ADD_AUTOMIX_ITEMS":
        return false;
    }
    return true;
  }

  private onYtmAdd(payload: QueuePayload) {
    if (this.replacingQueue) {
      // Playing something new: YTM clears the queue, then adds the new one.
      this.replacingQueue = false;
      const videoList = this.ownedBySelf(payload?.items ?? []);
      const index = this._videoList.length;
      if (videoList.length === 0) return;
      this._videoList = [...videoList];
      this.broadcast({ type: "ADD_SONGS", payload: { videoList }, after: [{ type: "SET_INDEX", payload: { index } }] });
      return;
    }
    // Play next / add to queue.
    if (payload?.items?.length !== 1) return;
    const videoList = this.ownedBySelf(payload.items);
    const hasIndex = Object.hasOwn(payload, "index");
    this._videoList.splice(hasIndex ? payload.index! : this._videoList.length, 0, ...videoList);
    this.broadcast({ type: "ADD_SONGS", payload: { ...(hasIndex ? { index: payload.index! } : {}), videoList } });
  }

  private ownedBySelf(items: QueueItem[]) {
    return mapQueueItem((it) => ({ videoId: it!.videoId, ownerId: this.owner!.id }) satisfies VideoData, items);
  }

  /** The queue's header says it's the session's, and autoplay is off. */
  initQueue() {
    this.dispatchSession({ type: "HAS_SHOWN_AUTOPLAY", payload: false });
    this.dispatchSession({ type: "SET_HEADER", payload: this.headerPayload() });
    this.dispatchSession({ type: "CLEAR_STEERING_CHIPS" });
  }

  async syncVideo() {
    const items = await queueRenderers(
      this.queue,
      this._videoList.map((video) => video.videoId),
    );
    if (!items) return false;
    const { nextQueueItemId } = this.store.getState().queue;
    this.dispatchSession({
      type: "UPDATE_ITEMS",
      payload: { items, nextQueueItemId, shouldAssignIds: true, currentIndex: -1 },
    });
    this.refresh();
    return true;
  }

  /** Shows who added each item: their avatar, and their name on hover. */
  syncQueueOwner() {
    const unknown = this.t("plugins.music-together.internal.unknown-user", "Unknown User");
    for (const queue of document.querySelectorAll("#queue")) {
      queue.querySelectorAll<HTMLElement>(QUEUE_ITEMS).forEach((item, index) => {
        const id = this._videoList[index]?.ownerId ?? "";
        decorateOwner(item, index, id, this.getProfile(id), unknown);
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

  /** Dispatches the session's change into YTM's queue without sending it back to the session. */
  private dispatchSession(event: StoreEvent) {
    this.applyingSession = true;
    this.queue.dispatch(event);
    this.applyingSession = false;
  }

  private broadcast(event: ConnectionEventUnion) {
    for (const listener of this.listeners) listener(event);
  }
}
