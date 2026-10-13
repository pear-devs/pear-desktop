import { test, expect } from '@playwright/test';
import { Window } from 'happy-dom';

import {
  getLikeStatus,
  getRepeatMode,
  isShuffled,
  nextTrack,
  previousTrack,
  switchRepeat,
  toggleShuffle,
  updateLike,
  watchPlayerState,
} from '../src/providers/player-ui';

type Calls = string[];

// The redesigned YTM player (Oct 2026) removed `ytmusic-player-bar` and
// `#like-button-renderer`; controls now live in `ytmusic-miniplayer`.
const createNewUi = (
  state: {
    shuffleEnabled?: boolean;
    repeatMode?: string;
    likes?: Record<string, string>;
    pressed?: 'like' | 'dislike';
  } = {},
) => {
  const calls: Calls = [];
  const listeners: (() => void)[] = [];
  let repeatMode = state.repeatMode ?? 'NONE';
  const { document } = new Window();
  document.body.innerHTML = `
    <div id="movie_player"></div>
    <ytmusic-player-queue id="queue"></ytmusic-player-queue>
    <ytmusic-miniplayer>
      <ytmusic-wiz-player-controls>
        <div class="ytmusicPlayerControlsMainControls">
          <button aria-pressed="false" id="shuffle"></button>
          <button></button>
          <button aria-pressed="false" id="repeat"></button>
        </div>
      </ytmusic-wiz-player-controls>
      <segmented-like-dislike-button-view-model>
        <like-button-view-model><button aria-pressed="${state.pressed === 'like'}"></button></like-button-view-model>
        <dislike-button-view-model><button aria-pressed="${state.pressed === 'dislike'}"></button></dislike-button-view-model>
      </segmented-like-dislike-button-view-model>
    </ytmusic-miniplayer>`;

  Object.assign(document.querySelector('#movie_player')!, {
    getVideoData: () => ({ video_id: 'abc123' }),
    nextVideo: () => calls.push('api.nextVideo'),
    previousVideo: () => calls.push('api.previousVideo'),
  });
  Object.assign(document.querySelector('#queue')!, {
    queue: {
      shuffle: () => calls.push('queue.shuffle'),
      store: {
        store: {
          getState: () => ({
            queue: {
              shuffleEnabled: state.shuffleEnabled ?? false,
              repeatMode,
            },
            likeStatus: { videos: state.likes ?? {}, playlists: {} },
          }),
          subscribe: (cb: () => void) => listeners.push(cb),
        },
      },
    },
  });
  document
    .querySelector('like-button-view-model button')!
    .addEventListener('click', () => calls.push('click.like'));
  document
    .querySelector('dislike-button-view-model button')!
    .addEventListener('click', () => calls.push('click.dislike'));
  document
    .querySelector('#shuffle')!
    .addEventListener('click', () => calls.push('click.shuffle'));
  // Like the real control, a click while the previous one is still being
  // applied is dropped.
  let repeatPending = false;
  document.querySelector('#repeat')!.addEventListener('click', () => {
    calls.push('click.repeat');
    if (repeatPending) return;
    repeatPending = true;
    setTimeout(() => {
      repeatMode = { NONE: 'ALL', ALL: 'ONE', ONE: 'NONE' }[repeatMode]!;
      repeatPending = false;
      listeners.forEach((l) => l());
    }, 10);
  });

  return { document: document as unknown as Document, calls };
};

const createOldUi = (
  opts: { shuffleOn?: boolean; likeStatus?: string } = {},
) => {
  const calls: Calls = [];
  const { document } = new Window();
  document.body.innerHTML = `
    <div id="movie_player"></div>
    <ytmusic-player-bar ${opts.shuffleOn ? 'shuffle-on' : ''}>
      <button class="previous-button ytmusic-player-bar"></button>
      <button class="next-button ytmusic-player-bar"></button>
      <ytmusic-like-button-renderer id="like-button-renderer"></ytmusic-like-button-renderer>
    </ytmusic-player-bar>`;

  Object.assign(document.querySelector('ytmusic-player-bar')!, {
    queue: { shuffle: () => calls.push('playerBar.queue.shuffle') },
    getState: () => ({ queue: { repeatMode: 'ALL' } }),
    onRepeatButtonClick: () => calls.push('onRepeatButtonClick'),
  });
  Object.assign(document.querySelector('#like-button-renderer')!, {
    likeStatus: opts.likeStatus ?? 'INDIFFERENT',
    updateLikeStatus: (s: string) => calls.push(`updateLikeStatus:${s}`),
  });
  document
    .querySelector('.previous-button')!
    .addEventListener('click', () => calls.push('click.previous'));
  document
    .querySelector('.next-button')!
    .addEventListener('click', () => calls.push('click.next'));

  return { document: document as unknown as Document, calls };
};

test.describe('player-ui: new YTM player UI', () => {
  test('isShuffled reads queue.shuffleEnabled from the store', () => {
    expect(isShuffled(createNewUi({ shuffleEnabled: true }).document)).toBe(
      true,
    );
    expect(isShuffled(createNewUi({ shuffleEnabled: false }).document)).toBe(
      false,
    );
  });

  test('toggleShuffle calls the #queue queue api', () => {
    const { document, calls } = createNewUi();
    toggleShuffle(document);
    expect(calls).toEqual(['queue.shuffle']);
  });

  // The store only records likes changed this session; a song liked earlier
  // shows up only as the button's pressed state.
  test('getLikeStatus falls back to the pressed like / dislike button', () => {
    expect(getLikeStatus(createNewUi({ pressed: 'like' }).document)).toBe(
      'LIKE',
    );
    expect(getLikeStatus(createNewUi({ pressed: 'dislike' }).document)).toBe(
      'DISLIKE',
    );
    expect(
      getLikeStatus(
        createNewUi({ pressed: 'like', likes: { abc123: 'INDIFFERENT' } })
          .document,
      ),
    ).toBe('INDIFFERENT');
  });

  test('getLikeStatus reads the current video from the store', () => {
    expect(
      getLikeStatus(createNewUi({ likes: { abc123: 'LIKE' } }).document),
    ).toBe('LIKE');
    expect(
      getLikeStatus(createNewUi({ likes: { other: 'LIKE' } }).document),
    ).toBe('INDIFFERENT');
  });

  test('updateLike clicks the miniplayer like / dislike button', () => {
    const { document, calls } = createNewUi();
    updateLike(document, 'LIKE');
    updateLike(document, 'DISLIKE');
    expect(calls).toEqual(['click.like', 'click.dislike']);
  });

  test('next / previous use the player api', () => {
    const { document, calls } = createNewUi();
    nextTrack(document);
    previousTrack(document);
    expect(calls).toEqual(['api.nextVideo', 'api.previousVideo']);
  });

  test('getRepeatMode reads queue.repeatMode from the store', () => {
    expect(getRepeatMode(createNewUi({ repeatMode: 'ONE' }).document)).toBe(
      'ONE',
    );
  });
});

test('new UI: switchRepeat waits for each step before clicking again', async () => {
  const { document, calls } = createNewUi();
  await switchRepeat(document, 2);
  expect(calls).toEqual(['click.repeat', 'click.repeat']);
  expect(getRepeatMode(document)).toBe('ONE');
});

test('legacy UI: switchRepeat uses the player bar', async () => {
  const { document, calls } = createOldUi();
  await switchRepeat(document, 1);
  expect(calls).toEqual(['onRepeatButtonClick']);
});

test.describe('player-ui: legacy player bar UI', () => {
  test('isShuffled reads the shuffle-on attribute', () => {
    expect(isShuffled(createOldUi({ shuffleOn: true }).document)).toBe(true);
    expect(isShuffled(createOldUi({ shuffleOn: false }).document)).toBe(false);
  });

  test('toggleShuffle uses the player bar queue', () => {
    const { document, calls } = createOldUi();
    toggleShuffle(document);
    expect(calls).toEqual(['playerBar.queue.shuffle']);
  });

  test('like state and updates go through #like-button-renderer', () => {
    const { document, calls } = createOldUi({ likeStatus: 'DISLIKE' });
    expect(getLikeStatus(document)).toBe('DISLIKE');
    updateLike(document, 'LIKE');
    expect(calls).toEqual(['updateLikeStatus:LIKE']);
  });

  test('next / previous click the player bar buttons', () => {
    const { document, calls } = createOldUi();
    nextTrack(document);
    previousTrack(document);
    expect(calls).toEqual(['click.next', 'click.previous']);
  });

  test('getRepeatMode reads the player bar state', () => {
    expect(getRepeatMode(createOldUi().document)).toBe('ALL');
  });
});

test.describe('player-ui: watchPlayerState', () => {
  test('notifies only when the selected value changes', () => {
    const { document } = new Window();
    const listeners: (() => void)[] = [];
    let state = { queue: { shuffleEnabled: false, repeatMode: 'NONE' } };
    document.body.innerHTML =
      '<ytmusic-player-queue id="queue"></ytmusic-player-queue>';
    Object.assign(document.querySelector('#queue')!, {
      queue: {
        store: {
          store: {
            getState: () => state,
            subscribe: (cb: () => void) => listeners.push(cb),
          },
        },
      },
    });

    const seen: boolean[] = [];
    const ok = watchPlayerState(
      document as unknown as Document,
      (s) => s.queue.shuffleEnabled,
      (v) => seen.push(v),
    );
    const emit = () => listeners.forEach((l) => l());

    emit();
    state = { queue: { shuffleEnabled: true, repeatMode: 'NONE' } };
    emit();
    state = { queue: { shuffleEnabled: true, repeatMode: 'ALL' } };
    emit();
    state = { queue: { shuffleEnabled: false, repeatMode: 'ALL' } };
    emit();

    expect(ok).toBe(true);
    expect(seen).toEqual([true, false]);
  });

  test('returns false when there is no store', () => {
    const { document } = new Window();
    expect(
      watchPlayerState(
        document as unknown as Document,
        () => 1,
        () => {},
      ),
    ).toBe(false);
  });
});
