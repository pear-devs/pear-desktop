import { EventEmitter } from 'node:events';
import { runInNewContext } from 'node:vm';

import { test, expect } from '@playwright/test';

import { installCosmeticInjection } from './cosmetics';

import type { ElectronBlocker } from '@ghostery/adblocker-electron';
import type { IpcMainInvokeEvent } from 'electron';

const fixture = () => {
  const contents = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    isLoadingMainFrame: () => true,
    getURL: () => 'https://fixture.invalid/',
    insertCSS: (_css: string) => {
      styles++;
      return Promise.resolve('fixture');
    },
    executeJavaScript: (script: string) => {
      executions.push(script);
      return Promise.resolve();
    },
  });
  let styles = 0;
  const executions: string[] = [];
  const frame: { detached: boolean; url: string } = {
    detached: false,
    url: contents.getURL(),
  };
  const event = {
    sender: contents,
    senderFrame: frame,
  } as unknown as IpcMainInvokeEvent;
  const engine = {
    getCosmeticsFilters: () => ({
      active: true,
      styles: '.fixture { display:none }',
      scripts: [
        'globalThis.order.push(1);',
        'throw new Error("fixture");',
        'globalThis.order.push(2);',
      ],
    }),
  } as unknown as ElectronBlocker;
  const dispose = installCosmeticInjection(engine);
  const inject = () => engine.onInjectCosmeticFilters(event, frame.url);
  return { contents, frame, executions, dispose, inject, styles: () => styles };
};

test('concurrent cosmetics share readiness listeners and preserve script order after failure', async () => {
  const f = fixture();
  try {
    const tasks = Array.from({ length: 25 }, () => f.inject());
    expect(f.contents.listenerCount('did-stop-loading')).toBe(1);
    expect(f.contents.listenerCount('dom-ready')).toBe(1);
    expect(f.executions).toHaveLength(0);
    f.contents.emit('dom-ready');
    await Promise.all(tasks);
    expect(f.contents.listenerCount('did-stop-loading')).toBe(0);
    expect(f.contents.listenerCount('destroyed')).toBe(0);
    expect(f.executions).toHaveLength(75);
    expect(f.styles()).toBe(25);
    const context = {
      order: [] as number[],
      console: { error: () => undefined },
    };
    for (const script of new Set(f.executions)) {
      try {
        runInNewContext(script, context);
      } catch {
        /* Native execution rejects invalid scripts independently. */
      }
    }
    expect(context.order).toEqual([1, 2]);
  } finally {
    f.dispose();
  }
});

test('dispose releases pending injections and prevents subsequent work', async () => {
  const f = fixture();
  const tasks = Array.from({ length: 25 }, () => f.inject());
  f.dispose();
  await Promise.all(tasks);
  await f.inject();
  expect(f.contents.eventNames()).toEqual([]);
  expect(f.executions).toEqual([]);
  expect(f.styles()).toBe(0);
});

test('navigation discards old cosmetics', async () => {
  const f = fixture();
  try {
    const task = f.inject();
    f.frame.url = 'https://fixture.invalid/next';
    f.contents.emit('did-stop-loading');
    await task;
    expect(f.executions).toEqual([]);
    expect(f.styles()).toBe(0);
  } finally {
    f.dispose();
  }
});

test('destroying contents releases readiness wait without injection', async () => {
  const f = fixture();
  try {
    const task = f.inject();
    f.contents.emit('destroyed');
    await task;
    expect(f.contents.eventNames()).toEqual([]);
    expect(f.executions).toEqual([]);
  } finally {
    f.dispose();
  }
});

test('same-URL document reload cancels pending old injections', async () => {
  const f = fixture();
  try {
    const task = f.inject();
    f.contents.emit('did-start-navigation', {}, f.frame.url, false, true);
    await task;
    expect(f.contents.eventNames()).toEqual([]);
    expect(f.executions).toEqual([]);
    expect(f.styles()).toBe(0);
  } finally {
    f.dispose();
  }
});
