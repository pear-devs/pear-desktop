import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';

// Run with: node --test tests/audio-only-mode.node.mjs
// Only the renderer factory is stubbed; the track and listener logic is real.
function setup() {
  let queueItem = null;
  const source = readFileSync(
    new URL('../src/plugins/audio-only-mode/renderer.ts', import.meta.url),
    'utf8',
  )
    .replace("import { createRenderer } from '@/utils';", '')
    .replace('export const renderer', 'globalThis.renderer');
  const context = vm.createContext({
    createRenderer: (renderer) => renderer,
    document: { querySelector: () => queueItem },
    console: { log() {}, warn() {} },
  });
  vm.runInContext(stripTypeScriptTypes(source), context);
  return {
    renderer: context.renderer,
    setQueue: (item) => {
      queueItem = item;
    },
  };
}

function player(type = 'OMV', videoId = 'video') {
  const listeners = new Set();
  const loads = [];
  return {
    listeners,
    loads,
    details: { videoId, musicVideoType: `MUSIC_VIDEO_TYPE_${type}` },
    getPlayerResponse() {
      return { videoDetails: this.details };
    },
    getCurrentTime: () => 42,
    addEventListener(event, handler) {
      assert.equal(event, 'onStateChange');
      listeners.add(handler);
    },
    removeEventListener(event, handler) {
      assert.equal(event, 'onStateChange');
      assert.ok(listeners.delete(handler));
    },
    loadVideoById(videoId, startSeconds) {
      const options = { videoId, startSeconds };
      loads.push(options);
      this.details = {
        videoId: options.videoId,
        musicVideoType: 'MUSIC_VIDEO_TYPE_ATV',
      };
      this.emit();
    },
    emit() {
      for (const handler of listeners) handler();
    },
  };
}

const queue = (id) => ({
  getMenuRenderer: () => ({
    items: [
      {},
      {
        toggleMenuServiceItemRenderer: {
          defaultServiceEndpoint: { likeEndpoint: { target: { videoId: id } } },
        },
      },
    ],
  }),
});

test('retries when the selected queue item becomes available', () => {
  const { renderer, setQueue } = setup();
  const api = player();
  renderer.onPlayerApiReady(api);
  assert.equal(renderer.lastVideoId, undefined);
  setQueue(queue('audio'));
  api.emit();
  assert.equal(api.loads.length, 1);
  assert.equal(api.loads[0].videoId, 'audio');
  assert.equal(api.loads[0].startSeconds, 42);
  assert.equal(renderer.lastVideoId, 'audio');
  api.emit();
  assert.equal(api.loads.length, 1);
});

test('retries when the queue menu or canonical ID becomes available', () => {
  const { renderer, setQueue } = setup();
  const api = player();
  setQueue({});
  renderer.onPlayerApiReady(api);
  assert.equal(renderer.lastVideoId, undefined);
  setQueue(queue(undefined));
  api.emit();
  assert.equal(renderer.lastVideoId, undefined);
  setQueue(queue('audio'));
  api.emit();
  assert.equal(api.loads.length, 1);
});

for (const type of ['ATV', 'UGC', 'UNKNOWN']) {
  test(`keeps ${type} playback unchanged`, () => {
    const { renderer, setQueue } = setup();
    const api = player(type);
    setQueue(queue('audio'));
    renderer.onPlayerApiReady(api);
    api.emit();
    assert.equal(api.loads.length, 0);
    assert.equal(renderer.lastVideoId, 'video');
  });
}

test('does not reload the current canonical ID', () => {
  const { renderer, setQueue } = setup();
  const api = player();
  setQueue(queue('video'));
  renderer.onPlayerApiReady(api);
  api.emit();
  assert.equal(api.loads.length, 0);
  assert.equal(renderer.lastVideoId, 'video');
});

test('repeated readiness replaces the listener on the same player', () => {
  const { renderer } = setup();
  const api = player('ATV');
  renderer.onPlayerApiReady(api);
  const oldHandler = renderer.stateChangeHandler;
  renderer.onPlayerApiReady(api);
  assert.equal(api.listeners.size, 1);
  assert.ok(!api.listeners.has(oldHandler));
  renderer.stop();
  assert.equal(api.listeners.size, 0);
  assert.equal(renderer.player, undefined);
  assert.equal(renderer.stateChangeHandler, undefined);
  assert.equal(renderer.lastVideoId, undefined);
});

test('new player detaches the old listener and rechecks the same track ID', () => {
  const { renderer, setQueue } = setup();
  const oldPlayer = player('ATV');
  renderer.onPlayerApiReady(oldPlayer);
  const newPlayer = player();
  setQueue(queue('audio'));
  renderer.onPlayerApiReady(newPlayer);
  assert.equal(oldPlayer.listeners.size, 0);
  assert.equal(newPlayer.listeners.size, 1);
  assert.equal(newPlayer.loads.length, 1);
  renderer.stop();
  assert.equal(newPlayer.listeners.size, 0);
  renderer.stop();
});
