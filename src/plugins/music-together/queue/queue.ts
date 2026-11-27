import { t } from '@/i18n';

import { getMusicQueueRenderer } from './song';
import { mapQueueItem } from './utils';

import { getDefaultProfile, type Profile, type VideoData } from '../types';

import type { QueueCommand } from '../session-protocol';
import type { QueueItem } from '@/types/datahost-get-state';
import type { QueueElement, Store } from '@/types/queue';

const getHeaderPayload = (() => {
  let payload: {
    items?: QueueItem[] | undefined;
    title: {
      runs: {
        text: string;
      }[];
    };
    subtitle: {
      runs: {
        text: string;
      }[];
    };
    buttons: {
      chipCloudChipRenderer: {
        style: {
          styleType: string;
        };
        text: {
          runs: {
            text: string;
          }[];
        };
        navigationEndpoint: {
          saveQueueToPlaylistCommand: unknown;
        };
        icon: {
          iconType: string;
        };
        accessibilityData: {
          accessibilityData: {
            label: string;
          };
        };
        isSelected: boolean;
        uniqueId: string;
      };
    }[];
  } | null = null;

  return () => {
    if (!payload) {
      payload = {
        title: {
          runs: [
            {
              text: t('plugins.music-together.internal.track-source'),
            },
          ],
        },
        subtitle: {
          runs: [
            {
              text: t('plugins.music-together.name'),
            },
          ],
        },
        buttons: [
          {
            chipCloudChipRenderer: {
              style: {
                styleType: 'STYLE_TRANSPARENT',
              },
              text: {
                runs: [
                  {
                    text: t('plugins.music-together.internal.save'),
                  },
                ],
              },
              navigationEndpoint: {
                saveQueueToPlaylistCommand: {},
              },
              icon: {
                iconType: 'ADD_TO_PLAYLIST',
              },
              accessibilityData: {
                accessibilityData: {
                  label: t('plugins.music-together.internal.save'),
                },
              },
              isSelected: false,
              uniqueId: t('plugins.music-together.internal.save'),
            },
          },
        ],
      };
    }

    return payload;
  };
})();

export class Queue {
  private readonly queue: QueueElement;
  private originalDispatch?: Store['dispatch'];
  private rollbackSelection?: () => void;
  private internalDispatch = false;
  private _videoList: VideoData[] = [];
  private playerItems: QueueItem[] = [];

  constructor(
    private readonly getProfile: (id: string) => Profile | undefined,
  ) {
    this.queue = document.querySelector<QueueElement>('#queue')!;
  }

  get isReady() {
    return Boolean(this.queue?.queue?.store?.store);
  }

  get handlesNativeSelection() {
    return this.rollbackSelection !== undefined;
  }

  containsEventPath(path: EventTarget[]) {
    return path.includes(this.queue);
  }

  get videoList() {
    return this._videoList;
  }

  get selectedIndex() {
    const queue = this.queue.queue.store.store.getState().queue;
    const index = queue.selectedItemIndex;
    if (Number.isInteger(index) && index >= 0 && index < queue.items.length) {
      return index;
    }
    return mapQueueItem((item) => item?.selected, queue.items).findIndex(
      Boolean,
    );
  }

  get repeatsQueue() {
    return this.queue.queue.store.store.getState().queue.repeatMode === 'ALL';
  }

  isHighlighted(index: number) {
    const item = this.rawItems[index];
    return (
      !!item && mapQueueItem((entry) => entry?.selected === true, [item])[0]
    );
  }

  get rawItems() {
    return this.queue.queue.store.store.getState().queue.items;
  }

  get flatItems() {
    return mapQueueItem((item) => item, this.rawItems);
  }

  adoptPlayerQueue(ownerId: string) {
    const rawItems = this.rawItems;
    const items = mapQueueItem((item) => item, rawItems);
    if (items.some((item) => !item?.videoId)) return false;
    if (
      items.length === this._videoList.length &&
      items.every(
        (item, index) =>
          rawItems[index] === this.playerItems[index] &&
          item?.videoId === this._videoList[index].videoId,
      )
    )
      return false;

    // Inserts can put a second copy of a song before its existing queue entry.
    const previous = new Map(
      this.playerItems.map((item, index) => [item, this._videoList[index]]),
    );
    const matched = rawItems.map((item, index) => {
      const entry = previous.get(item);
      previous.delete(item);
      return entry?.videoId === items[index]?.videoId ? entry : undefined;
    });
    const retained = new Set(matched);
    const existing = new Map<string, VideoData[]>();
    for (const item of this._videoList) {
      if (retained.has(item)) continue;
      const entries = existing.get(item.videoId) ?? [];
      entries.push(item);
      existing.set(item.videoId, entries);
    }

    const next = items.map((item, index) => {
      const videoId = item!.videoId;
      return (
        matched[index] ??
        existing.get(videoId)?.shift() ?? {
          entryId: crypto.randomUUID(),
          videoId,
          ownerId,
        }
      );
    });
    this.playerItems = rawItems.slice();
    if (
      next.length === this._videoList.length &&
      next.every((item, index) => item === this._videoList[index])
    ) {
      return false;
    }
    this._videoList = next;
    this.syncQueueOwner();
    return true;
  }

  private async fetchQueueItems(
    target: Parameters<typeof getMusicQueueRenderer>[0],
  ) {
    const request = getMusicQueueRenderer(target);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), 10_000);
    });
    const response = await Promise.race([request, timeout]).finally(() =>
      clearTimeout(timer),
    );
    return (
      response?.queueDatas.map((item) => item?.content).filter(Boolean) ?? null
    );
  }

  private async fetchItems(videoIds: string[]) {
    if (!videoIds.length) return [];
    const items = await this.fetchQueueItems({
      videoIds: [...new Set(videoIds)],
    });
    if (!items) return null;
    const ids = mapQueueItem((item) => item?.videoId, items);
    const renderers = new Map(ids.map((id, index) => [id, items[index]]));
    if (!videoIds.every((id) => renderers.has(id))) return null;
    return videoIds.map((id) => structuredClone(renderers.get(id)!));
  }

  async setVideoList(list: VideoData[], isActive: () => boolean) {
    const rawItems = this.rawItems;
    const current = mapQueueItem((item) => item, rawItems);
    const reusable = new Map(
      this._videoList.flatMap((entry, index) =>
        current[index]?.videoId === entry.videoId
          ? [[entry.entryId, rawItems[index]] as const]
          : [],
      ),
    );
    const missing = list.filter((entry) => !reusable.has(entry.entryId));
    const fetched = await this.fetchItems(
      missing.map((entry) => entry.videoId),
    );
    if (!fetched || !isActive()) return false;

    let next = 0;
    const items = list.map(
      (entry) => reusable.get(entry.entryId) ?? fetched[next++],
    );
    // A Play Next or append can be applied without rebuilding the active queue.
    const added = list.length - this._videoList.length;
    const old = this._videoList;
    if (
      added > 0 &&
      old.length &&
      current.length === old.length &&
      current.every((item, index) => item?.videoId === old[index].videoId)
    ) {
      const firstChange = old.findIndex(
        (entry, index) => entry.entryId !== list[index].entryId,
      );
      const index = firstChange < 0 ? old.length : firstChange;
      if (
        old
          .slice(index)
          .every(
            (entry, offset) =>
              entry.entryId === list[index + added + offset].entryId,
          )
      ) {
        this.insertItems(items.slice(index, index + added), index);
        this._videoList = list;
        this.refreshQueue();
        return true;
      }
    }
    this.replaceItems(list, items);
    return true;
  }

  private replaceItems(list: VideoData[], items: QueueItem[]) {
    this.dispatch('UPDATE_ITEMS', {
      items,
      nextQueueItemId:
        this.queue.queue.store.store.getState().queue.nextQueueItemId,
      shouldAssignIds: true,
      // The native reducer retains rows through currentIndex before adding items.
      currentIndex: -1,
    });
    this._videoList = list;
    this.refreshQueue();
  }

  async addVideos(videos: VideoData[], getIndex: () => number | undefined) {
    const items = await this.fetchItems(videos.map((entry) => entry.videoId));
    return items ? this.insertEntries(videos, items, getIndex) : false;
  }

  async addPlaylist(
    playlistId: string,
    ownerId: string,
    getIndex: () => number | undefined,
  ) {
    const playlist = await this.fetchPlaylist(playlistId, ownerId);
    return playlist
      ? this.insertEntries(playlist.entries, playlist.items, getIndex)
      : false;
  }

  async setPlaylist(
    playlistId: string,
    ownerId: string,
    canCommit: () => boolean,
  ) {
    const playlist = await this.fetchPlaylist(playlistId, ownerId);
    if (!playlist || !canCommit()) return false;
    this.replaceItems(playlist.entries, playlist.items);
    return true;
  }

  private async fetchPlaylist(playlistId: string, ownerId: string) {
    const items = await this.fetchQueueItems({ playlistId });
    if (!items?.length) return false;

    const videoIds = mapQueueItem((item) => item?.videoId, items);
    if (videoIds.some((id) => !id)) return false;
    const entries = videoIds.map((videoId) => ({
      entryId: crypto.randomUUID(),
      videoId: videoId!,
      ownerId,
    }));
    return { entries, items };
  }

  private insertEntries(
    entries: VideoData[],
    items: QueueItem[],
    getIndex: () => number | undefined,
  ) {
    const index = getIndex();
    if (index === undefined) return false;

    this.insertItems(items, index);
    this._videoList.splice(index, 0, ...entries);
    this.refreshQueue();
    return true;
  }

  private insertItems(items: QueueItem[], index: number) {
    this.dispatch('ADD_ITEMS', {
      nextQueueItemId:
        this.queue.queue.store.store.getState().queue.nextQueueItemId,
      index,
      items,
      shuffleEnabled: false,
      shouldAssignIds: true,
    });
  }

  removeVideo(index: number) {
    const count = this.rawItems.length;
    this.dispatch('REMOVE_ITEM', index);
    if (this.rawItems.length !== count - 1) return false;
    this._videoList.splice(index, 1);
    this.refreshQueue();
    return true;
  }

  setIndex(index: number) {
    this.dispatch('SET_INDEX', index);
  }

  moveItem(fromIndex: number, toIndex: number) {
    this.dispatch('MOVE_ITEM', { fromIndex, toIndex });
    const [entry] = this._videoList.splice(fromIndex, 1);
    this._videoList.splice(toIndex, 0, entry);
    this.refreshQueue();
  }

  private dispatch(type: string, payload?: unknown) {
    this.internalDispatch = true;
    try {
      this.queue.dispatch({ type, payload });
    } finally {
      this.internalDispatch = false;
    }
  }

  private refreshQueue() {
    this.playerItems = this.rawItems.slice();
    const dispatch = this.originalDispatch;
    setTimeout(() => {
      if (!dispatch || this.originalDispatch !== dispatch) return;
      this.initQueue();
      this.syncQueueOwner();
    }, 0);
  }

  rollbackInjection() {
    this.rollbackSelection?.();
    this.rollbackSelection = undefined;
    if (!this.originalDispatch) return;
    this.queue.queue.store.store.dispatch = this.originalDispatch;
    this.originalDispatch = undefined;
    this._videoList = [];
    this.playerItems = [];
  }

  injection(
    mode: 'host' | 'guest',
    send: (command: QueueCommand) => void,
    onNativeQueueChange: () => void,
  ) {
    if (mode === 'guest') {
      const native = this.queue.queue as QueueElement['queue'] & {
        selectQueueItem?: (item: QueueItem) => void;
      };
      const select = native.selectQueueItem;
      if (typeof select === 'function') {
        const intercepted = (item: QueueItem) => {
          if (this.internalDispatch) return select.call(native, item);
          const entry = this._videoList[this.rawItems.indexOf(item)];
          if (entry) send({ kind: 'select', entryId: entry.entryId });
        };
        native.selectQueueItem = intercepted;
        this.rollbackSelection = () => {
          if (native.selectQueueItem === intercepted)
            native.selectQueueItem = select;
        };
      }
    }
    const store = this.queue.queue.store.store;
    const original = store.dispatch;
    this.originalDispatch = original;
    store.dispatch = (event) => {
      if (!this.internalDispatch) {
        if (mode === 'host') {
          if (event.type === 'ADD_AUTOMIX_ITEMS') {
            const payload = event.payload as {
              automixItems: QueueItem[];
              nextQueueItemId: number;
              shouldAssignIds: boolean;
            };
            // Use the host's suggestions as shared, playable queue entries.
            const seen = new Set(this.flatItems.map((item) => item?.videoId));
            const items = payload.automixItems.filter((item) => {
              const [videoId] = mapQueueItem((entry) => entry?.videoId, [item]);
              if (!videoId || seen.has(videoId)) return false;
              seen.add(videoId);
              return true;
            });
            if (items.length) {
              original.call(store, {
                type: 'ADD_ITEMS',
                payload: {
                  index: this.rawItems.length,
                  items,
                  nextQueueItemId: payload.nextQueueItemId,
                  shouldAssignIds: payload.shouldAssignIds,
                  shuffleEnabled: false,
                },
              });
              onNativeQueueChange();
            }
            return;
          }
          if (
            event.type === 'CLEAR' ||
            event.type === 'ADD_ITEMS' ||
            event.type === 'UPDATE_ITEMS' ||
            event.type === 'SET_INDEX'
          ) {
            original.call(store, event);
            onNativeQueueChange();
            return;
          }
        }
        if (event.type === 'CLEAR') return;
        if (event.type === 'ADD_ITEMS') {
          const { items, index } = event.payload as {
            items: QueueItem[];
            index?: number;
          };
          const tracks = mapQueueItem((item) => item, items);
          const videoIds = tracks.flatMap((item) =>
            item?.videoId ? [item.videoId] : [],
          );
          if (videoIds.length && !tracks.some((item) => item?.selected)) {
            send({
              kind: 'add',
              videoIds,
              before:
                this._videoList[index ?? this._videoList.length]?.entryId ??
                null,
            });
          }
          return;
        }
        if (event.type === 'MOVE_ITEM') {
          const { fromIndex, toIndex } = event.payload as {
            fromIndex: number;
            toIndex: number;
          };
          const entry = this._videoList[fromIndex];
          if (entry && fromIndex !== toIndex) {
            const remaining = this._videoList.filter((item) => item !== entry);
            send({
              kind: 'move',
              entryId: entry.entryId,
              before: remaining[toIndex]?.entryId ?? null,
            });
          }
          return;
        }
        if (event.type === 'REMOVE_ITEM' || event.type === 'SET_INDEX') {
          const entry = this._videoList[event.payload as number];
          if (entry) {
            send({
              kind: event.type === 'REMOVE_ITEM' ? 'remove' : 'select',
              entryId: entry.entryId,
            });
          }
          return;
        }
        if (event.type === 'SET_HEADER') {
          original.call(store, { ...event, payload: getHeaderPayload() });
          return;
        }
        if (event.type === 'ADD_STEERING_CHIPS') {
          original.call(store, { type: 'CLEAR_STEERING_CHIPS' });
          return;
        }
        if (
          event.type === 'SET_PLAYER_UI_STATE' &&
          event.payload === 'INACTIVE' &&
          this._videoList.length
        )
          return;
        if (
          event.type === 'HAS_SHOWN_AUTOPLAY' ||
          event.type === 'ADD_AUTOMIX_ITEMS'
        )
          return;
        if (mode === 'guest' && event.type === 'UPDATE_ITEMS') return;
      }
      original.call(store, event);
    };
  }

  /* sync */
  initQueue() {
    if (!this.queue) return;

    this.internalDispatch = true;
    this.queue.dispatch({
      type: 'HAS_SHOWN_AUTOPLAY',
      payload: false,
    });
    this.queue.dispatch({
      type: 'SET_HEADER',
      payload: getHeaderPayload(),
    });
    this.queue.dispatch({
      type: 'CLEAR_STEERING_CHIPS',
    });
    this.internalDispatch = false;
  }

  syncQueueOwner() {
    const allQueue = document.querySelectorAll('#queue');

    allQueue.forEach((queue) => {
      const list = Array.from(
        queue?.querySelectorAll<HTMLElement>(
          '#contents > ytmusic-player-queue-item,#contents > ytmusic-playlist-panel-video-wrapper-renderer > #primary-renderer > ytmusic-player-queue-item',
        ) ?? [],
      );

      list.forEach((item, index: number | undefined) => {
        if (typeof index !== 'number') return;

        const id = this._videoList[index]?.ownerId;
        let data = this.getProfile(id);

        const profile =
          item.querySelector<HTMLImageElement>('.music-together-owner') ??
          document.createElement('img');
        profile.classList.add('music-together-owner');
        profile.dataset.id = id;
        profile.dataset.index = index.toString();

        const name =
          item.querySelector<HTMLElement>('.music-together-name') ??
          document.createElement('div');
        name.classList.add('music-together-name');
        name.textContent =
          data?.name ?? t('plugins.music-together.internal.unknown-user');

        if (!data?.name && !data?.handleId) {
          data = getDefaultProfile(data?.id ?? '');
        }

        if (data) {
          profile.dataset.thumbnail = data.thumbnail ?? '';
          profile.dataset.name = data.name ?? '';
          profile.dataset.handleId = data.handleId ?? '';
          profile.dataset.id = data.id ?? '';

          profile.src = data.thumbnail ?? '';
          profile.title = data.name ?? '';
          profile.alt = data.handleId ?? '';
        }

        if (!profile.isConnected) item.append(profile);
        if (!name.isConnected) item.append(name);
      });
    });
  }

  removeQueueOwner() {
    const allQueue = document.querySelectorAll('#queue');

    allQueue.forEach((queue) => {
      const list = Array.from(
        queue?.querySelectorAll<HTMLElement>('ytmusic-player-queue-item') ?? [],
      );

      list.forEach((item) => {
        const profile = item.querySelector<HTMLImageElement>(
          '.music-together-owner',
        );
        const name = item.querySelector<HTMLElement>('.music-together-name');
        profile?.remove();
        name?.remove();
      });
    });
  }
}
