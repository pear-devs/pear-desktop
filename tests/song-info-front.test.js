import { test as base, expect } from '@playwright/test';
import { Window } from 'happy-dom';

const test = base.extend({
  playback: async ({}, use) => {
    const window = new Window();
    const globals = {
      window,
      document: window.document,
      HTMLVideoElement: window.HTMLVideoElement,
      CustomEvent: window.CustomEvent,
    };
    const originalGlobals = new Map(
      Object.keys(globals).map((key) => [
        key,
        Object.getOwnPropertyDescriptor(globalThis, key),
      ]),
    );
    Object.assign(globalThis, globals);

    const messages = [];
    window.ipcRenderer = {
      on() {},
      send(channel, payload) {
        messages.push({ channel, payload });
      },
    };
    const video = window.document.createElement('video');
    window.document.body.append(video);

    try {
      const { setupSongInfo } =
        await import('../src/providers/song-info-front');
      setupSongInfo({ addEventListener() {} });

      await use({
        messages,
        emit(type, currentTime) {
          video.currentTime = currentTime;
          video.dispatchEvent(new window.Event(type));
        },
      });
    } finally {
      await window.happyDOM.close();
      for (const [key, descriptor] of originalGlobals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    }
  },
});

for (const seconds of [0, 0.1, 0.49]) {
  test(`reports playback starting at ${seconds} seconds`, ({ playback }) => {
    playback.emit('playing', seconds);

    expect(playback.messages).toEqual([
      {
        channel: 'peard:play-or-paused',
        payload: { isPaused: false, elapsedSeconds: 0 },
      },
    ]);
  });
}

test('reports playing again when the same track repeats', ({ playback }) => {
  for (let repeat = 0; repeat < 3; repeat++) {
    playback.emit('pause', 180);
    playback.emit('playing', 0);
  }

  expect(playback.messages.map(({ payload }) => payload)).toEqual(
    Array.from({ length: 3 }, () => [
      { isPaused: true, elapsedSeconds: 180 },
      { isPaused: false, elapsedSeconds: 0 },
    ]).flat(),
  );
});

test('reports pausing after seeking back to the start', ({ playback }) => {
  playback.emit('playing', 12.75);
  playback.emit('pause', 0);

  expect(playback.messages.map(({ payload }) => payload)).toEqual([
    { isPaused: false, elapsedSeconds: 12 },
    { isPaused: true, elapsedSeconds: 0 },
  ]);
});

test('preserves normal pause and resume updates', ({ playback }) => {
  playback.emit('pause', 42.75);
  playback.emit('playing', 42.75);

  expect(playback.messages.map(({ payload }) => payload)).toEqual([
    { isPaused: true, elapsedSeconds: 42 },
    { isPaused: false, elapsedSeconds: 42 },
  ]);
});
