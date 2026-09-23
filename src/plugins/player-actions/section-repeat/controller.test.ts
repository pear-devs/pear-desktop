import { registerHooks } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

import { test, expect } from '@playwright/test';

import type {
  SectionRepeatConfig,
  SectionRepeatController,
} from './controller';
import type { SavedSection } from './saved';

/**
 * The controller's renderer entry pulls in Vite-only virtual modules and CSS
 * `?inline` imports. Stub those at the loader boundary so the real controller
 * can run headless over a happy-dom document.
 */
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'virtual:i18n') {
      return {
        url: 'data:text/javascript,export const languageResources = async () => ({});',
        shortCircuit: true,
      };
    }
    if (specifier.endsWith('?inline')) {
      return {
        url: 'data:text/javascript,export default "";',
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});

type PlayerApi = Parameters<SectionRepeatController['onPlayerApiReady']>[0];

const savedEntry = (
  videoId: string,
  startSeconds: number | null,
  endSeconds: number | null,
): SavedSection => ({ videoId, startSeconds, endSeconds });

let createController:
  | (typeof import('./controller'))['createSectionRepeatController']
  | null = null;

const controllers: SectionRepeatController[] = [];

test.afterEach(() => {
  for (const controller of controllers) controller.stop();
  controllers.length = 0;
});

/** A fake <video> whose time is writable/readable and whose state is static. */
function createFakeVideo(duration: number): HTMLVideoElement {
  const element = document.createElement('video');
  const video = element as unknown as HTMLVideoElement;
  let time = 0;
  Object.defineProperty(video, 'currentTime', {
    configurable: true,
    get: () => time,
    set: (value: number) => {
      time = value;
    },
  });
  Object.defineProperty(video, 'duration', {
    configurable: true,
    get: () => duration,
  });
  Object.defineProperty(video, 'paused', {
    configurable: true,
    get: () => false,
  });
  Object.defineProperty(video, 'seeking', {
    configurable: true,
    get: () => false,
  });
  return video;
}

async function boot(options: { saved: SavedSection[]; duration?: number }) {
  const { Window } = await import('happy-dom');
  const win = new Window();
  (win as unknown as { ipcRenderer: unknown }).ipcRenderer = {
    on() {},
    send() {},
  };

  const globals = globalThis as unknown as Record<string, unknown>;
  globals.window = win;
  globals.document = win.document;
  globals.CustomEvent = win.CustomEvent;
  globals.Event = win.Event;
  globals.MutationObserver = win.MutationObserver;
  globals.Node = win.Node;
  globals.Element = win.Element;
  globals.HTMLElement = win.HTMLElement;
  globals.HTMLButtonElement = win.HTMLButtonElement;
  globals.HTMLVideoElement = win.HTMLVideoElement;

  const video = createFakeVideo(options.duration ?? 100);
  win.document.body.appendChild(
    video as unknown as Parameters<typeof win.document.body.appendChild>[0],
  );

  if (createController === null) {
    const module = await import('./controller');
    createController = module.createSectionRepeatController;
  }
  const controller = createController();
  const setConfigCalls: Partial<SectionRepeatConfig>[] = [];
  const ctx = {
    // oxlint-disable-next-line typescript/require-await
    getConfig: async () => ({ active: true, saved: options.saved }),
    setConfig: (patch: Partial<SectionRepeatConfig>) => {
      setConfigCalls.push(patch);
    },
  };
  controllers.push(controller);
  return { win, video, controller, ctx, setConfigCalls };
}

function changeSong(videoId: string): void {
  document.dispatchEvent(
    new CustomEvent('videodatachange', { detail: { videoData: { videoId } } }),
  );
}

/** The renderer's synthetic song-change signal: no `videoData.videoId`. */
function changeSongWithoutId(): void {
  document.dispatchEvent(new CustomEvent('videodatachange', { detail: {} }));
}

test('enabling mid-song applies the saved section without a song-change event', async () => {
  const { video, controller, ctx } = await boot({
    saved: [savedEntry('song-a', 10, 20)],
  });
  // The plugin is enabled while song-a is already playing: no
  // `videodatachange` will fire for the current song, so the enable-time seed
  // must adopt the player's id and apply its saved section.
  controller.api = {
    getPlayerResponse: () => ({ videoDetails: { videoId: 'song-a' } }),
  } as unknown as PlayerApi;
  video.currentTime = 3;

  await controller.start(ctx);

  expect(controller.latestVideoId).toBe('song-a');
  expect(controller.restoredVideoId).toBe('song-a');
  expect(controller.pendingRestoreSeek).toBe(false);
  expect(video.currentTime).toBe(10);
});

test('the API arriving after start applies the saved section', async () => {
  const { video, controller, ctx } = await boot({
    saved: [savedEntry('song-a', 10, 20)],
  });
  // start() runs before the API arrives, so it cannot seed; the later hook must.
  await controller.start(ctx);
  expect(controller.latestVideoId).toBeNull();
  expect(video.currentTime).toBe(0);

  controller.onPlayerApiReady({
    getPlayerResponse: () => ({ videoDetails: { videoId: 'song-a' } }),
  } as unknown as PlayerApi);

  expect(controller.latestVideoId).toBe('song-a');
  expect(video.currentTime).toBe(10);
});

test('a seeded id yields to a later real change for another song', async () => {
  const { video, controller, ctx } = await boot({
    saved: [savedEntry('song-a', 10, 20), savedEntry('song-b', 30, 40)],
  });
  controller.api = {
    getPlayerResponse: () => ({ videoDetails: { videoId: 'song-a' } }),
  } as unknown as PlayerApi;

  await controller.start(ctx);
  expect(video.currentTime).toBe(10);

  // The event is authoritative once it fires: the next song's own entry wins.
  changeSong('song-b');
  expect(controller.latestVideoId).toBe('song-b');
  expect(video.currentTime).toBe(30);
});

test('an event id is never overridden by a trailing API id', async () => {
  const { video, controller, ctx } = await boot({
    saved: [savedEntry('song-a', 10, 20), savedEntry('song-x', 70, 80)],
  });
  await controller.start(ctx);
  changeSong('song-a');
  expect(video.currentTime).toBe(10);

  // The API still reports the previous song (it trails a change). An id is
  // already latched from the event, so the seed must be a no-op.
  controller.onPlayerApiReady({
    getPlayerResponse: () => ({ videoDetails: { videoId: 'song-x' } }),
  } as unknown as PlayerApi);

  expect(controller.latestVideoId).toBe('song-a');
  expect(video.currentTime).toBe(10);
});

test('a saved entry applies once the authoritative id arrives', async () => {
  const { video, controller, ctx } = await boot({
    saved: [savedEntry('song-a', 10, 20)],
  });

  await controller.start(ctx);
  expect(video.currentTime).toBe(0);

  changeSong('song-a');

  expect(controller.latestVideoId).toBe('song-a');
  expect(controller.restoredVideoId).toBe('song-a');
  expect(controller.pendingRestoreSeek).toBe(false);
  expect(video.currentTime).toBe(10);
});

test('settle re-applies a restore the player overrode', async () => {
  const { video, controller, ctx } = await boot({
    saved: [savedEntry('song-a', 10, 20)],
  });
  await controller.start(ctx);
  changeSong('song-a');
  expect(video.currentTime).toBe(10);

  // Below the loop threshold, so only the settle pass can correct it.
  video.currentTime = 5;
  await delay(1500);

  expect(video.currentTime).toBe(10);
});

test('settle leaves an unsaved song untouched', async () => {
  const { video, controller, ctx } = await boot({
    saved: [savedEntry('song-a', 10, 20)],
  });
  await controller.start(ctx);
  changeSong('song-a');
  changeSong('song-b');

  expect(video.currentTime).toBe(10);
  video.currentTime = 5;
  await delay(1500);

  expect(video.currentTime).toBe(5);
});

test('settle aborts once the authoritative id moves on', async () => {
  const { video, controller, ctx } = await boot({
    saved: [savedEntry('song-a', 10, 20)],
  });
  await controller.start(ctx);
  changeSong('song-a');
  expect(video.currentTime).toBe(10);

  controller.latestVideoId = 'song-c';
  video.currentTime = 5;
  await delay(1500);

  expect(video.currentTime).toBe(5);
});

test('settle accepts playback that advanced past a working restore', async () => {
  const { video, controller, ctx } = await boot({
    saved: [savedEntry('song-a', 10, 20)],
  });
  await controller.start(ctx);
  changeSong('song-a');
  expect(video.currentTime).toBe(10);

  // A seek that worked leaves playback just past the target after the settle
  // grace (~10 + 1.2 s). Re-seeking that band is the audible rewind; the
  // settle pass must leave it alone rather than re-apply the seek.
  video.currentTime = 11.2;
  await delay(1500);

  expect(video.currentTime).toBe(11.2);
});

test('settle accepts a successful restore when its timer fired late', async () => {
  const { video, controller, ctx } = await boot({
    saved: [savedEntry('song-a', 10, 20)],
  });
  await controller.start(ctx);
  changeSong('song-a');
  expect(video.currentTime).toBe(10);

  // The setTimeout can fire late on a busy song change: by the time this pass
  // runs, a restore that actually SUCCEEDED has already played further than
  // the NOMINAL SETTLE_MS grace. The acceptance band must widen to the ACTUAL
  // elapsed time, not the nominal delay. Pre-fix the band ended at
  // target + SETTLE_MS/1000 + SETTLE_TOLERANCE_SECONDS (~11.7 s), so this
  // position fell outside it and the pass re-seeked to 10, reintroducing the
  // audible rewind. Here the timer fired 5 s late, so the band must reach ~15.
  const armedAt = Date.now() - 5000;
  video.currentTime = 15;
  controller.runSettleCheck(
    controller.latestVideoId,
    controller.restoredVideoId,
    controller.lastUserSeekAt,
    armedAt,
  );

  expect(video.currentTime).toBe(15);
});

test('settle still corrects a restore that never landed', async () => {
  const { video, controller, ctx } = await boot({
    saved: [savedEntry('song-a', 10, 20)],
  });
  await controller.start(ctx);
  changeSong('song-a');
  expect(video.currentTime).toBe(10);

  // The player ignored the seek and fell back to the song start, which is
  // outside the successful-seek band; the settle pass must re-apply it.
  video.currentTime = 2;
  await delay(1500);

  expect(video.currentTime).toBe(10);
});

test('settle does not fire while a loop is engaged', async () => {
  const { video, controller, ctx } = await boot({
    saved: [savedEntry('song-a', 10, 20)],
  });
  await controller.start(ctx);
  changeSong('song-a');
  expect(video.currentTime).toBe(10);

  // Repeat is on with points set, so the 100 ms loop tick owns the position;
  // even a large forward drift must not be yanked back by the settle pass.
  video.currentTime = 15;
  await delay(1500);

  expect(video.currentTime).toBe(15);
});

test('a payload-less song change drops the stale id and defers', async () => {
  const { video, controller, ctx } = await boot({
    saved: [savedEntry('song-a', 10, 20), savedEntry('song-b', 30, 40)],
  });
  await controller.start(ctx);
  changeSong('song-a');
  expect(video.currentTime).toBe(10);

  // The player advances to the next song with no id in the payload; the
  // previous id must not survive to steer the restore.
  video.currentTime = 50;
  changeSongWithoutId();

  expect(controller.latestVideoId).toBeNull();
  expect(controller.restoredVideoId).toBeNull();

  // The src-changed restore path has no id of its own: it must defer, not
  // seek onto song-a.
  video.dispatchEvent(new Event('peard:src-changed'));
  expect(video.currentTime).toBe(50);

  // Only a payload-bearing change for the new song applies its own target.
  changeSong('song-b');
  expect(video.currentTime).toBe(30);
});

test('a payload-less change on a replaced video defers instead of seeking', async () => {
  const { video, controller, ctx } = await boot({
    saved: [savedEntry('song-a', 10, 20), savedEntry('song-b', 30, 40)],
  });
  await controller.start(ctx);
  changeSong('song-a');
  expect(video.currentTime).toBe(10);

  // The player swaps the <video> for the next song, then signals the change
  // with no id. The replaced-element restore path must defer, not seek the
  // new element onto song-a's saved start.
  const replacement = createFakeVideo(100);
  video.remove();
  document.body.appendChild(
    replacement as unknown as Parameters<typeof document.body.appendChild>[0],
  );
  changeSongWithoutId();

  expect(controller.latestVideoId).toBeNull();
  expect(replacement.currentTime).toBe(0);

  changeSong('song-b');
  expect(replacement.currentTime).toBe(30);
});
