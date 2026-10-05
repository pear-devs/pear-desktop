import { test, expect } from '@playwright/test';
import { onCleanup } from 'solid-js';

import {
  LyricsLifecycle,
  observeLyricsTask,
  waitForLyricsElement,
} from './lifecycle';
import {
  registerReactiveRoot,
  startReactiveRoot,
  disposeReactiveRoot,
} from './reactive-root';

test('lifetime disposes owned resources once and cleans late registrations immediately', () => {
  const lifetime = new LyricsLifecycle();
  const calls: number[] = [];
  lifetime.add(() => calls.push(1));
  lifetime.add(() => calls.push(2));
  lifetime.dispose();
  lifetime.dispose();
  expect(lifetime.controller.signal.aborted).toBe(true);
  expect(calls).toEqual([2, 1]);
  lifetime.add(() => calls.push(3));
  expect(calls).toEqual([2, 1, 3]);
});

test('DOM wait abort disconnects observer and settles; found element also cleans up', async () => {
  const original = Object.getOwnPropertyDescriptor(
    globalThis,
    'MutationObserver',
  );
  let disconnected = 0;
  let callback: (() => void) | undefined;
  Object.defineProperty(globalThis, 'MutationObserver', {
    configurable: true,
    value: class {
      constructor(cb: () => void) {
        callback = cb;
      }
      observe() {}
      disconnect() {
        disconnected++;
      }
    },
  });
  try {
    let element: Element | null = null;
    const root = {
      querySelector: () => element,
      documentElement: {},
    } as unknown as Document;
    const lifetime = new LyricsLifecycle();
    const waiting = waitForLyricsElement(
      'test',
      lifetime.controller.signal,
      root,
    );
    lifetime.dispose();
    expect(await waiting).toBeNull();
    expect(disconnected).toBe(1);
    const next = new LyricsLifecycle();
    const found = waitForLyricsElement('test', next.controller.signal, root);
    element = {} as Element;
    callback!();
    expect(await found).toBe(element);
    expect(disconnected).toBe(2);
    next.dispose();
    expect(disconnected).toBe(2);
  } finally {
    if (original)
      Object.defineProperty(globalThis, 'MutationObserver', original);
    else Reflect.deleteProperty(globalThis, 'MutationObserver');
  }
});

test('module reactive root can stop and restart, disposing each generation', () => {
  let starts = 0;
  let stops = 0;
  registerReactiveRoot(() => {
    starts++;
    onCleanup(() => stops++);
  });
  startReactiveRoot();
  disposeReactiveRoot();
  disposeReactiveRoot();
  expect([starts, stops]).toEqual([1, 1]);
  startReactiveRoot();
  disposeReactiveRoot();
  expect([starts, stops]).toEqual([2, 2]);
});

test('disposed presentation task cannot write into an obsolete component', async () => {
  const values: string[] = [];
  const cancel = observeLyricsTask(Promise.resolve('stale'), (value) =>
    values.push(value),
  );
  cancel();
  observeLyricsTask(Promise.resolve('current'), (value) => values.push(value));
  await Promise.resolve();
  expect(values).toEqual(['current']);
});
