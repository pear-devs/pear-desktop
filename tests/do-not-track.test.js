import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { test, expect, _electron as electron } from '@playwright/test';
import { build } from 'vite';

import { modulePath } from './helpers/module-path.js';

test('cosmetics on actual Electron loading window do not accumulate native execution listeners', async ({}, testInfo) => {
  const directory = testInfo.outputPath('fixture');
  await build({
    configFile: false,
    logLevel: 'error',
    build: {
      outDir: directory,
      lib: {
        entry: {
          cosmetics: path.resolve('src/plugins/do-not-track/cosmetics.ts'),
          blocker: path.resolve('src/plugins/do-not-track/blocker.ts'),
          plugin: path.resolve('src/plugins/do-not-track/index.ts'),
        },
        formats: ['cjs'],
        fileName: (_format, name) => `${name}.cjs`,
      },
      rollupOptions: {
        external: [
          'electron',
          '@ghostery/adblocker-electron',
          '@ghostery/adblocker-electron-preload',
          '@/i18n',
          '@/utils',
          'node:crypto',
          'node:fs',
          'node:path',
        ],
        output: {
          paths: {
            '@ghostery/adblocker-electron': modulePath(
              createRequire(import.meta.url).resolve(
                '@ghostery/adblocker-electron',
              ),
            ),
            '@/i18n': modulePath(path.join(directory, 'i18n.cjs')),
            '@/utils': modulePath(path.join(directory, 'utils.cjs')),
          },
        },
      },
    },
  });
  writeFileSync(path.join(directory, 'i18n.cjs'), 'exports.t = key => key;');
  writeFileSync(
    path.join(directory, 'utils.cjs'),
    'exports.createPlugin = plugin => plugin;',
  );
  const entry = path.join(directory, 'main.cjs');
  writeFileSync(
    entry,
    `
const { app, BrowserWindow, protocol } = require('electron');
const { installCosmeticInjection } = require('./cosmetics.cjs');
const blocker = require('./blocker.cjs');
const { ElectronBlocker } = require(${JSON.stringify(createRequire(import.meta.url).resolve('@ghostery/adblocker-electron'))});
globalThis.checkProfileNotification = async () => {
  const loaded = require('./plugin.cjs');
  const plugin = loaded.default || loaded;
  const backend = plugin.backend;
  const { dialog } = require('electron');
  const window = globalThis.fixtureWindow;
  const originalDialog = dialog.showMessageBox;
  const originalReload = window.webContents.reload;
  const originalFromLists = ElectronBlocker.fromLists;
  let dialogs = 0, reloads = 0, response = 1;
  dialog.showMessageBox = async () => { dialogs++; return { response, checkboxChecked: false }; };
  window.webContents.reload = () => { reloads++; };
  ElectronBlocker.fromLists = async () => ElectronBlocker.parse('||tracker.fixture.invalid^');
  const config = { ...plugin.config, enabled: true, cache: false };
  try {
    await backend.start({ window, getConfig: async () => config, setConfig: async () => {} });
    const startupDialogs = dialogs;
    await backend.onConfigChange({ ...config, blocker: 'Balanced' });
    await new Promise(setImmediate);
    const laterReloads = reloads;
    response = 0;
    await backend.onConfigChange({ ...config, blocker: 'Strict' });
    await new Promise(setImmediate);
    const confirmedReloads = reloads;
    response = 1;
    await backend.onConfigChange(config);
    await new Promise(setImmediate);
    return { startupDialogs, laterReloads, confirmedReloads, liteReloads: reloads, dialogs };
  } finally {
    backend.stop({ window });
    dialog.showMessageBox = originalDialog;
    window.webContents.reload = originalReload;
    ElectronBlocker.fromLists = originalFromLists;
  }
};
globalThis.checkBlockerLifecycle = async () => {
  const session = require('electron').session.defaultSession;
  const original = ElectronBlocker.fromLists;
  const engine = ElectronBlocker.parse('||tracker.fixture.invalid^');
  let finish;
  ElectronBlocker.fromLists = () => new Promise(resolve => { finish = resolve; });
  try {
    const loading = blocker.loadTrackerBlockerEngine(session, false, [], [], [], true, false);
    blocker.unloadTrackerBlockerEngine(session);
    finish(engine);
    await loading;
    const staleEnabled = blocker.isBlockerEnabled(session);
    ElectronBlocker.fromLists = async () => engine;
    const before = session.getPreloadScripts().map(({id}) => id);
    await blocker.loadTrackerBlockerEngine(session, false, [], [], [], true, false);
    const enabled = blocker.isBlockerEnabled(session);
    blocker.unloadTrackerBlockerEngine(session, true);
    const observerDisabled = await globalThis.fixtureWindow.webContents.executeJavaScript("require('electron').ipcRenderer.invoke('@ghostery/adblocker/is-mutation-observer-enabled')");
    await globalThis.fixtureWindow.webContents.executeJavaScript("require('electron').ipcRenderer.invoke('@ghostery/adblocker/inject-cosmetic-filters', location.href)");
    ElectronBlocker.fromLists = async () => ElectronBlocker.parse('||tracker.fixture.invalid^');
    await blocker.loadTrackerBlockerEngine(session, false, [], [], [], true, false);
    const reenabled = blocker.isBlockerEnabled(session);
    blocker.unloadTrackerBlockerEngine(session);
    return { staleEnabled, enabled, reenabled, observerDisabled, disabled: !blocker.isBlockerEnabled(session), preloadsPreserved: JSON.stringify(before) === JSON.stringify(session.getPreloadScripts().map(({id}) => id)) };
  } finally { ElectronBlocker.fromLists = original; }
};
globalThis.warnings = [];
globalThis.scriptErrors = 0;
const originalConsoleError = console.error;
console.error = (...args) => {
  if (args[0] === '@ghostery/adblocker scriptlet crashed') globalThis.scriptErrors++;
  else originalConsoleError(...args);
};
process.on('warning', warning => globalThis.warnings.push(warning.name));
app.whenReady().then(() => {
  protocol.handle('https', () => new Promise(resolve => {
    globalThis.finishLoading = () => resolve(new Response('<html><body>Fixture</body></html>', { headers: { 'content-type': 'text/html' } }));
  }));
  const window = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } });
  window.loadURL('https://fixture.invalid/');
  globalThis.fixtureWindow = window;
  globalThis.engine = { getCosmeticsFilters: () => ({ active: true, styles: '', scripts: ['throw new Error("fixture");', 'invalid syntax fixture', ...Array.from({ length: 25 }, () => 'globalThis.fixtureCount = (globalThis.fixtureCount || 0) + 1;')] }) };
  globalThis.dispose = installCosmeticInjection(globalThis.engine);
});
`,
  );
  const app = await electron.launch({
    env: {
      ...process.env,
      NODE_PATH: path.resolve('node_modules'),
      XDG_CONFIG_HOME: testInfo.outputPath('config'),
      XDG_CACHE_HOME: testInfo.outputPath('cache'),
    },
    args: [
      entry,
      '--no-sandbox',
      '--disable-gpu',
      `--user-data-dir=${testInfo.outputPath('profile')}`,
    ],
    timeout: 30000,
  });
  try {
    await expect
      .poll(() => app.evaluate(() => typeof globalThis.finishLoading))
      .toBe('function');
    const count = await app.evaluate(() => {
      const contents = globalThis.fixtureWindow.webContents;
      const baseline = contents.listenerCount('did-stop-loading');
      globalThis.injection = globalThis.engine.onInjectCosmeticFilters(
        {
          sender: contents,
          senderFrame: contents.mainFrame,
          frameId: contents.mainFrame.routingId,
          processId: contents.mainFrame.processId,
        },
        'https://fixture.invalid/',
      );
      return contents.listenerCount('did-stop-loading') - baseline;
    });
    expect(count).toBeLessThanOrEqual(1);
    await app.evaluate(() => globalThis.finishLoading());
    const page = await app.firstWindow();
    await app.evaluate(async () => {
      await globalThis.injection;
    });
    expect(await page.evaluate(() => globalThis.fixtureCount)).toBe(25);
    expect(await app.evaluate(() => globalThis.scriptErrors)).toBe(2);
    expect(await app.evaluate(() => globalThis.warnings)).not.toContain(
      'MaxListenersExceededWarning',
    );
    await app.evaluate(() => globalThis.dispose());
    expect(
      await app.evaluate(() => globalThis.checkBlockerLifecycle()),
    ).toEqual({
      staleEnabled: false,
      enabled: true,
      reenabled: true,
      observerDisabled: false,
      disabled: true,
      preloadsPreserved: true,
    });
    expect(
      await app.evaluate(() => globalThis.checkProfileNotification()),
    ).toEqual({
      startupDialogs: 0,
      laterReloads: 0,
      confirmedReloads: 1,
      liteReloads: 1,
      dialogs: 3,
    });
  } finally {
    await app.close();
  }
});
