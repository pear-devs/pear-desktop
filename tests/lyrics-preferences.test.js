import path from 'node:path';
import process from 'node:process';

import { test, expect, _electron as electron } from '@playwright/test';

test('lyrics Auto survives actual Electron config merge and process restart', async ({}, testInfo) => {
  const launch = () =>
    electron.launch({
      cwd: path.resolve(import.meta.dirname, '..'),
      env: {
        ...process.env,
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
  let app = await launch();
  try {
    // Creating an explicit disabled plugin config can trigger the application's
    // restart-needed dialog (old enabled is undefined). Do not leave a native
    // modal open while testing config persistence/closing the process.
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = () =>
        Promise.resolve({ response: 1, checkboxChecked: false });
    });
    let page = await app.firstWindow();
    await page.waitForFunction(
      () => typeof window.ipcRenderer?.invoke === 'function',
    );
    await page.evaluate(async () => {
      await window.ipcRenderer.invoke('peard:set-config', 'synced-lyrics', {
        enabled: false,
        preferredProvider: 'LRCLib',
      });
      await window.ipcRenderer.invoke('peard:set-config', 'synced-lyrics', {
        preferredProvider: 'auto',
      });
    });
    expect(
      await page.evaluate(() =>
        window.ipcRenderer.invoke('peard:get-config', 'synced-lyrics'),
      ),
    ).toMatchObject({ preferredProvider: 'auto' });
    await test.step('close first process', () => app.close());
    app = await test.step('restart same profile', launch);
    page = await app.firstWindow();
    await page.waitForFunction(
      () => typeof window.ipcRenderer?.invoke === 'function',
    );
    expect(
      await page.evaluate(() =>
        window.ipcRenderer.invoke('peard:get-config', 'synced-lyrics'),
      ),
    ).toMatchObject({ preferredProvider: 'auto' });
  } finally {
    await app.close();
  }
});
