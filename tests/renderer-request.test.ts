import { EventEmitter } from 'node:events';

import { test, expect } from '@playwright/test';

import { requestFromRenderer } from '../src/plugins/api-server/backend/renderer-request';

import type { IpcMain } from 'electron';

const RESPONSE = 'peard:test-response';

// ipcMain is an EventEmitter; a plain one stands in for it.
const createIpc = () => new EventEmitter() as unknown as IpcMain;

test('resolves with the renderer response', async () => {
  const ipc = createIpc();
  const value = await requestFromRenderer<string>(
    ipc,
    () => setTimeout(() => ipc.emit(RESPONSE, {}, 'LIKE'), 5),
    RESPONSE,
    100,
  );

  expect(value).toBe('LIKE');
  expect(ipc.listenerCount(RESPONSE)).toBe(0);
});

test('resolves undefined and drops its listener when nobody answers', async () => {
  const ipc = createIpc();
  const value = await requestFromRenderer<string>(ipc, () => {}, RESPONSE, 20);

  expect(value).toBeUndefined();
  expect(ipc.listenerCount(RESPONSE)).toBe(0);
});
