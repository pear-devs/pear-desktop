import { LikeType, type GetState } from '@/types/datahost-get-state';

import type { MusicPlayer } from '@/types/music-player';
import type { QueueElement, Store } from '@/types/queue';

// Player controls that work on both YTM player UIs:
// - legacy: `ytmusic-player-bar` + `#like-button-renderer` (Polymer)
// - new (Oct 2026): `ytmusic-miniplayer`, whose controls expose no element
//   API, so state comes from the queue's redux store and actions go through
//   the queue / player api, or a click on the miniplayer's own like button.

type PlayerBarElement = HTMLElement & {
  queue?: { shuffle: () => void };
  getState?: () => GetState;
  onRepeatButtonClick?: () => void;
};

type LikeButtonRendererElement = HTMLElement & {
  likeStatus?: LikeType;
  updateLikeStatus?: (status: LikeType) => void;
};

const getPlayerBar = (root: ParentNode) =>
  root.querySelector<PlayerBarElement>('ytmusic-player-bar');

const getLikeButtonRenderer = (root: ParentNode) =>
  root.querySelector<LikeButtonRendererElement>('#like-button-renderer');

const getPlayerApi = (root: ParentNode) =>
  root.querySelector<HTMLElement & Partial<MusicPlayer>>('#movie_player');

const getStore = (root: ParentNode): Store | undefined =>
  root.querySelector<QueueElement>('#queue')?.queue?.store?.store;

const getStoreState = (root: ParentNode) => getStore(root)?.getState();

export const isShuffled = (root: ParentNode = document): boolean => {
  const playerBar = getPlayerBar(root);
  if (playerBar) return playerBar.hasAttribute('shuffle-on');

  return getStoreState(root)?.queue?.shuffleEnabled === true;
};

export const toggleShuffle = (root: ParentNode = document) => {
  const playerBar = getPlayerBar(root);
  if (playerBar) {
    playerBar.queue?.shuffle();
    return;
  }

  root.querySelector<QueueElement>('#queue')?.queue?.shuffle?.();
};

const mapLikeStatus = (status: unknown): LikeType =>
  Object.values(LikeType).includes(status as LikeType)
    ? (status as LikeType)
    : LikeType.Indifferent;

export const getLikeStatus = (root: ParentNode = document): LikeType => {
  const likeButtonRenderer = getLikeButtonRenderer(root);
  if (likeButtonRenderer) return mapLikeStatus(likeButtonRenderer.likeStatus);

  // The store only holds likes changed this session; for anything else the
  // miniplayer buttons' pressed state is the source of truth.
  const videoId = getPlayerApi(root)?.getVideoData?.()?.video_id;
  const stored = videoId
    ? getStoreState(root)?.likeStatus?.videos?.[videoId]
    : undefined;
  if (stored) return mapLikeStatus(stored);

  const isPressed = (button: 'like' | 'dislike') =>
    root
      .querySelector(`ytmusic-miniplayer ${button}-button-view-model button`)
      ?.getAttribute('aria-pressed') === 'true';
  if (isPressed('like')) return LikeType.Like;
  if (isPressed('dislike')) return LikeType.Dislike;

  return LikeType.Indifferent;
};

// On the new UI this clicks the button, so liking an already liked song
// clears the like.
export const updateLike = (
  root: ParentNode,
  status: LikeType | `${LikeType}`,
) => {
  const likeButtonRenderer = getLikeButtonRenderer(root);
  if (likeButtonRenderer) {
    likeButtonRenderer.updateLikeStatus?.(status as LikeType);
    return;
  }

  const button = status === LikeType.Dislike ? 'dislike' : 'like';
  root
    .querySelector<HTMLElement>(
      `ytmusic-miniplayer ${button}-button-view-model button`,
    )
    ?.click();
};

export const nextTrack = (root: ParentNode = document) => {
  const button = root.querySelector<HTMLElement>(
    '.next-button.ytmusic-player-bar',
  );
  if (button) button.click();
  else getPlayerApi(root)?.nextVideo?.();
};

export const previousTrack = (root: ParentNode = document) => {
  const button = root.querySelector<HTMLElement>(
    '.previous-button.ytmusic-player-bar',
  );
  if (button) button.click();
  else getPlayerApi(root)?.previousVideo?.();
};

export const getRepeatMode = (root: ParentNode = document) =>
  (getPlayerBar(root)?.getState?.() ?? getStoreState(root))?.queue?.repeatMode;

// Calls `onChange` whenever the selected store value changes. Returns false
// when the store isn't available, so callers can report "unsupported".
export const watchPlayerState = <T>(
  root: ParentNode,
  select: (state: GetState) => T,
  onChange: (value: T) => void,
): boolean => {
  const store = getStore(root);
  if (!store) return false;

  let last = select(store.getState());
  store.subscribe(() => {
    const next = select(store.getState());
    if (next !== last) {
      last = next;
      onChange(next);
    }
  });

  return true;
};

const REPEAT_STEP_TIMEOUT_MS = 1000;

const waitForRepeatModeChange = async (root: ParentNode, from: unknown) => {
  const deadline = Date.now() + REPEAT_STEP_TIMEOUT_MS;
  while (getRepeatMode(root) === from && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

// The new controls only have two toggle buttons, shuffle then repeat, and no
// locale-independent marker, so repeat is the last `aria-pressed` button.
// It ignores clicks while the previous one is applied, so wait between steps.
export const switchRepeat = async (
  root: ParentNode = document,
  iterations = 1,
) => {
  for (let i = 0; i < iterations; i++) {
    const playerBar = getPlayerBar(root);
    if (playerBar) {
      playerBar.onRepeatButtonClick?.();
      continue;
    }

    const before = getRepeatMode(root);
    [
      ...root.querySelectorAll<HTMLElement>(
        'ytmusic-miniplayer .ytmusicPlayerControlsMainControls button[aria-pressed]',
      ),
    ]
      .at(-1)
      ?.click();
    await waitForRepeatModeChange(root, before);
  }
};
