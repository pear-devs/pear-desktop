import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { test, expect, _electron as electron } from '@playwright/test';

process.env.NODE_ENV = 'test';

const appPath = path.resolve(import.meta.dirname, '..');

/** Boot the app with the mini player enabled in a throwaway user data dir. */
const launchWithMiniPlayer = async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytm-mini-'));

  fs.writeFileSync(
    path.join(userDataDir, 'config.json'),
    JSON.stringify({
      __internal__: { migrations: { version: '3.12.0' } },
      plugins: {
        'mini-player': {
          enabled: true,
          openOnStart: true,
          hideMainWindow: false,
          opacity: 1,
        },
      },
    }),
  );

  const app = await electron.launch({
    cwd: appPath,
    args: [
      appPath,
      `--user-data-dir=${userDataDir}`,
      '--no-sandbox',
      '--disable-gpu',
      '--whitelisted-ips=',
      '--disable-dev-shm-usage',
    ],
  });

  return { app, userDataDir };
};

const getMiniPlayerWindow = async (app) => {
  for (let attempt = 0; attempt < 60; attempt++) {
    const window = app
      .windows()
      .find((candidate) => candidate.url().includes('mini-player'));

    if (window) {
      return window;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error('mini player window never appeared');
};

test('Mini player - opens, renders pushed state and forwards controls', async () => {
  test.setTimeout(120_000);

  const { app } = await launchWithMiniPlayer();
  const miniPlayer = await getMiniPlayerWindow(app);

  await miniPlayer.waitForSelector('#bar');

  // The window must be frameless, transparent and on top.
  const windowFlags = await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((candidate) =>
      candidate.webContents.getURL().includes('mini-player'),
    );

    return {
      isAlwaysOnTop: window.isAlwaysOnTop(),
      isResizable: window.isResizable(),
      size: window.getSize(),
    };
  });

  expect(windowFlags.isAlwaysOnTop).toBe(true);
  expect(windowFlags.isResizable).toBe(true);
  expect(windowFlags.size[0]).toBe(400);

  // Push a song state through the same channel the backend uses.
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((candidate) =>
      candidate.webContents.getURL().includes('mini-player'),
    );

    window.webContents.send('mini-player:state', {
      title: 'Bohemian Rhapsody',
      artist: 'Queen',
      imageSrc: '',
      isPaused: false,
      songDuration: 200,
      elapsedSeconds: 50,
      likeStatus: 'LIKE',
      volume: 60,
      isMuted: false,
    });
  });

  await expect(miniPlayer.locator('#title')).toHaveText('Bohemian Rhapsody');
  await expect(miniPlayer.locator('#artist')).toHaveText('Queen');
  await expect(miniPlayer.locator('#like')).toHaveClass(/liked/);

  // 50s of 200s => the progress fill covers a quarter of the bar.
  const fillRatio = await miniPlayer.evaluate(() => {
    const fill = document.getElementById('fill');
    const rail = document.getElementById('rail');
    return (
      fill.getBoundingClientRect().width / rail.getBoundingClientRect().width
    );
  });

  expect(fillRatio).toBeGreaterThan(0.2);
  expect(fillRatio).toBeLessThan(0.35);

  // Clicking a control must reach the main process over the preload bridge.
  const nextControl = app.evaluate(
    ({ ipcMain }) =>
      new Promise((resolve) => {
        ipcMain.once('mini-player:control', (_event, action) =>
          resolve(action),
        );
      }),
  );

  await miniPlayer.locator('[data-action="next"]').click();
  expect(await nextControl).toBe('next');

  await app.close();
});
