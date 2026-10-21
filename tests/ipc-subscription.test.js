import path from 'node:path';
import process from 'node:process';

import { test, expect, _electron as electron } from '@playwright/test';

process.env.NODE_ENV = 'test';

test('renderer IPC disposer survives contextBridge and removes only its own listener', async ({}, testInfo) => {
  const app = await electron.launch({
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {
      ...process.env,
      // Exercise production's unsandboxed preload; default launch test covers
      // the separate sandbox-only testing branch.
      NODE_ENV: 'production',
      XDG_CONFIG_HOME: testInfo.outputPath('config'),
      XDG_CACHE_HOME: testInfo.outputPath('cache'),
    },
    args: [
      path.resolve(import.meta.dirname, '..'),
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--user-data-dir=${testInfo.outputPath('electron-profile')}`,
    ],
  });
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(
      () => typeof window.ipcRenderer?.subscribe === 'function',
    );
    await page.evaluate(() => {
      window.subscriptionCounts = [0, 0];
      window.disposeSubscription = window.ipcRenderer.subscribe(
        'synced-lyrics:test-subscription',
        () => {
          window.subscriptionCounts[0]++;
        },
      );
      window.disposeOtherSubscription = window.ipcRenderer.subscribe(
        'synced-lyrics:test-subscription',
        () => {
          window.subscriptionCounts[1]++;
        },
      );
    });
    const send = () =>
      app.evaluate(({ BrowserWindow }) => {
        for (const window of BrowserWindow.getAllWindows())
          window.webContents.send('synced-lyrics:test-subscription');
      });
    await send();
    await expect
      .poll(() => page.evaluate(() => window.subscriptionCounts))
      .toEqual([1, 1]);
    await page.evaluate(() => {
      window.disposeSubscription();
      window.disposeSubscription();
    });
    await send();
    await expect
      .poll(() => page.evaluate(() => window.subscriptionCounts))
      .toEqual([1, 2]);
    await page.evaluate(() => window.disposeOtherSubscription());
  } finally {
    await app.close();
  }
});
