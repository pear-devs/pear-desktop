import { EventEmitter } from 'node:events';

import { test, expect } from '@playwright/test';

import { setupCloseToHide } from '../src/providers/window-close';

const createWindow = (fullscreen = false) => {
  const app = new EventEmitter();
  const win = new EventEmitter();
  const calls = [];
  let destroyed = false;
  Object.assign(win, {
    isFullScreen: () => fullscreen,
    isDestroyed: () => destroyed,
    setFullScreen: (value) => calls.push(['setFullScreen', value]),
    hide: () => calls.push(['hide']),
  });
  setupCloseToHide(app, win);

  return {
    app,
    win,
    calls,
    close() {
      let prevented = false;
      win.emit('close', {
        preventDefault() {
          prevented = true;
        },
      });
      return prevented;
    },
    finishFullscreenExit() {
      fullscreen = false;
      win.emit('leave-full-screen');
    },
    destroy() {
      destroyed = true;
      win.emit('closed');
    },
  };
};

test('closing a window hides it without quitting', () => {
  const window = createWindow();
  expect(window.close()).toBe(true);
  expect(window.calls).toEqual([['hide']]);
});

test('quitting allows the window to close instead of hiding', () => {
  const window = createWindow(true);
  window.app.emit('before-quit');
  expect(window.close()).toBe(false);
  expect(window.calls).toEqual([]);
});

test.describe('macOS fullscreen close', () => {
  test.skip(process.platform !== 'darwin', 'Native macOS fullscreen behavior');

  test('waits for the fullscreen Space to close before hiding', () => {
    const window = createWindow(true);
    expect(window.close()).toBe(true);
    expect(window.calls).toEqual([['setFullScreen', false]]);

    window.finishFullscreenExit();
    expect(window.calls).toEqual([['setFullScreen', false], ['hide']]);

    // The window can be reopened and closed normally afterward.
    expect(window.close()).toBe(true);
    expect(window.calls.at(-1)).toEqual(['hide']);
  });

  test('repeated close requests do not hide during the transition', () => {
    const window = createWindow(true);
    expect(window.close()).toBe(true);
    expect(window.close()).toBe(true);
    expect(window.calls).toEqual([['setFullScreen', false]]);

    window.finishFullscreenExit();
    expect(window.calls).toEqual([['setFullScreen', false], ['hide']]);
    expect(window.win.listenerCount('leave-full-screen')).toBe(0);
  });

  test('quitting during the fullscreen transition does not hide the window', () => {
    const window = createWindow(true);
    window.close();
    window.app.emit('before-quit');
    expect(window.close()).toBe(false);
    window.finishFullscreenExit();
    expect(window.calls).toEqual([['setFullScreen', false]]);
  });

  test('destroying the window cleans up pending transition handlers', () => {
    const window = createWindow(true);
    window.close();
    window.destroy();
    window.finishFullscreenExit();
    expect(window.calls).toEqual([['setFullScreen', false]]);
    expect(window.app.listenerCount('before-quit')).toBe(0);
    expect(window.win.listenerCount('leave-full-screen')).toBe(0);
  });
});

test('non-macOS tray close keeps its immediate hide behavior', () => {
  test.skip(process.platform === 'darwin');
  const window = createWindow(true);
  expect(window.close()).toBe(true);
  expect(window.calls).toEqual([['hide']]);
});
