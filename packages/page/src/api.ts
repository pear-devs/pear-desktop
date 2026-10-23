// The page half of the core API server: what only YTM's own
// elements can answer (queue, search, likes, fullscreen, song details).
// Registered once; costs nothing while the server is off.

import type { LikeStatus } from "@pear/sdk";
import { selectors, type SelectorName } from "@pear/sdk/selectors";
import { readSongDetails } from "@pear/sdk/song-details";
import { YTM_NAME } from "@pear/sdk/util";
import type { Player } from "./player.ts";
import type { PluginRunner } from "./plugins.ts";

interface QueueStoreState {
  queue: { items: QueueItem[]; queueContextParams: unknown; nextQueueItemId: unknown };
}
interface QueueItem {
  playlistPanelVideoRenderer?: { selected?: boolean };
  playlistPanelVideoWrapperRenderer?: { primaryRenderer?: { playlistPanelVideoRenderer?: { selected?: boolean } } };
}
type QueueAction = { type: string; payload?: unknown };
interface QueueElement extends HTMLElement {
  dispatch(action: QueueAction): void;
  queue?: {
    getItems(): QueueItem[];
    autoPlaying?: boolean;
    continuation?: string;
    store: { store: { dispatch(action: QueueAction): void; getState(): QueueStoreState } };
  };
}
interface NetworkManagerApp extends HTMLElement {
  networkManager: { fetch<T = unknown>(path: string, body: unknown): Promise<T> };
}
interface LikeButtons extends HTMLElement {
  updateLikeStatus?(status: string): void;
}
interface SearchBox extends HTMLElement {
  getSearchboxStats?(): unknown;
}

type Handle = (event: string, handler: (payload: unknown) => unknown) => void;

const $ = <E extends Element = HTMLElement>(name: SelectorName) => document.querySelector<E>(selectors[name]);
const queue = () => $<QueueElement>("queue");

// Answers go over IPC: drop anything that isn't plain JSON.
const plain = <T,>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)));

export function registerApiHandlers(runner: PluginRunner, player: Player) {
  const handle: Handle = (event, handler) => runner.handleCore(event, handler);
  handle("details", () => (player.api ? readSongDetails(player.api) : null));
  handle("like", (status) => setLikeStatus(player, status as string));
  registerFullscreen(handle);
  registerQueue(handle);
  handle("search", search);
}

/** "LIKE" or "DISLIKE": sets it, like the buttons do (pressing an active one again would clear it). */
function setLikeStatus(player: Player, status: string) {
  const classic = $<LikeButtons>("player_bar.like_buttons");
  if (classic?.updateLikeStatus) return classic.updateLikeStatus(status);
  const wanted = LIKE_BUTTONS[status];
  if (wanted && player.state.like !== wanted.status) $(wanted.button)?.click();
}

const LIKE_BUTTONS: Record<string, { status: LikeStatus; button: SelectorName }> = {
  LIKE: { status: "like", button: "player_bar.like" },
  DISLIKE: { status: "dislike", button: "player_bar.dislike" },
};

function registerFullscreen(handle: Handle) {
  const isFullscreen = () => !!$("integrations.fullscreen");
  handle("fullscreen", isFullscreen);
  handle("fullscreen:set", (fullscreen) => {
    if (isFullscreen() === fullscreen) return;
    if (fullscreen) return $("integrations.fullscreen_button")?.click();
    // The new player bar's layout has no exit button; Escape (exitFullscreen) is how it leaves.
    const exit = $("integrations.exit_fullscreen_button");
    if (exit) exit.click();
    else void document.exitFullscreen().catch(() => {});
  });
}

function registerQueue(handle: Handle) {
  handle("queue", () => {
    const api = queue()?.queue;
    if (!api) return null;
    return plain({ items: api.getItems(), autoPlaying: api.autoPlaying, continuation: api.continuation });
  });
  handle("queue:add", (payload) => addToQueue(payload as { videoId: string; insertPosition: string }));
  handle("queue:move", (payload) => queue()?.dispatch({ type: "MOVE_ITEM", payload }));
  handle("queue:remove", (index) => queue()?.dispatch({ type: "REMOVE_ITEM", payload: index }));
  handle("queue:set-index", (index) => queue()?.dispatch({ type: "SET_INDEX", payload: index }));
  handle("queue:clear", () => {
    const element = queue();
    element?.queue?.store.store.dispatch({ type: "SET_PLAYER_PAGE_INFO", payload: { open: false } });
    element?.dispatch({ type: "CLEAR" });
  });
}

async function addToQueue({ videoId, insertPosition }: { videoId: string; insertPosition: string }) {
  const element = queue();
  const store = element?.queue?.store.store;
  const app = $<NetworkManagerApp>("app");
  if (!element || !store || !app) throw new Error("queue unavailable");
  const result = await app.networkManager.fetch<{ queueDatas?: { content?: unknown }[] }>("/music/get_queue", {
    queueContextParams: store.getState().queue.queueContextParams,
    queueInsertPosition: insertPosition,
    videoIds: [videoId],
  });
  if (!Array.isArray(result?.queueDatas)) throw new Error(`${YTM_NAME} returned no queue items`);
  const { items, nextQueueItemId } = store.getState().queue;
  const afterCurrent = insertPosition === "INSERT_AFTER_CURRENT_VIDEO";
  element.dispatch({
    type: "ADD_ITEMS",
    payload: {
      nextQueueItemId,
      index: afterCurrent ? indexAfterSelected(items) : items.length,
      items: result.queueDatas.map((data) => data?.content).filter(Boolean),
      shuffleEnabled: false,
      shouldAssignIds: true,
    },
  });
}

/** Right after the playing item; the end when none is playing. */
function indexAfterSelected(items: QueueItem[]) {
  const selected = items.findIndex((item) => videoRenderer(item)?.selected);
  return selected === -1 ? items.length : selected + 1;
}

const videoRenderer = (item: QueueItem) =>
  item.playlistPanelVideoRenderer ?? item.playlistPanelVideoWrapperRenderer?.primaryRenderer?.playlistPanelVideoRenderer;

async function search(payload: unknown) {
  const { query, params, continuation } = payload as { query: string; params?: string; continuation?: string };
  const app = $<NetworkManagerApp>("app");
  const searchBox = $<SearchBox>("nav_bar.search_box");
  if (!app) throw new Error(`${YTM_NAME} isn't ready`);
  const suggestStats = searchBox?.getSearchboxStats?.();
  return plain(await app.networkManager.fetch("/search", { query, params, continuation, suggestStats }));
}
