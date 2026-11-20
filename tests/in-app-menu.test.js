import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { test, expect, _electron as electron } from '@playwright/test';
import { build } from 'vite';
import solid from 'vite-plugin-solid';

const root = path.resolve(import.meta.dirname, '..');
let renderer;
let stylesheet;

test.beforeAll(async () => {
  const result = await build({
    configFile: false,
    logLevel: 'error',
    plugins: [
      solid(),
      {
        name: 'test-i18n-resources',
        resolveId: (id) => (id === 'virtual:i18n' ? id : undefined),
        load: (id) =>
          id === 'virtual:i18n'
            ? 'export const languageResources = async () => ({});'
            : undefined,
      },
    ],
    resolve: { alias: { '@': path.join(root, 'src') } },
    build: {
      write: false,
      lib: {
        entry: path.join(root, 'tests/fixtures/in-app-menu.ts'),
        formats: ['iife'],
        name: 'inAppMenu',
      },
    },
  });
  const output = Array.isArray(result) ? result[0].output : result.output;
  renderer = output.find((file) => file.type === 'chunk').code;
  stylesheet = await readFile(
    path.join(root, 'src/plugins/in-app-menu/titlebar.css'),
    'utf8',
  );
});

async function launch(
  testInfo,
  { hideBarWhenCollapsed, collapsed = true, userAgent = 'Linux' } = {},
) {
  const app = await electron.launch({
    args: [
      path.join(root, 'tests/fixtures/in-app-menu.cjs'),
      testInfo.outputPath('user-data'),
      '--no-sandbox',
      '--disable-gpu',
    ],
  });
  try {
    const window = await app.firstWindow();
    await window.setContent(`
      <style>
        body { margin: 0; }
        ytmusic-app-layout { display: block; }
      </style>
      <ytmusic-app><ytmusic-player></ytmusic-player></ytmusic-app>
      <ytmusic-app-layout id="layout"><div id="content">Music</div></ytmusic-app-layout>
    `);
    await window.addStyleTag({ content: stylesheet });
    await window.evaluate(
      ({ collapsed, hideBarWhenCollapsed, userAgent }) => {
        Object.defineProperty(navigator, 'userAgent', { value: userAgent });
        window.mainConfig = { get: () => collapsed };
        const listeners = {};
        window.menuConfig = {
          enabled: true,
          hideDOMWindowControls: false,
        };
        if (hideBarWhenCollapsed !== undefined) {
          window.menuConfig.hideBarWhenCollapsed = hideBarWhenCollapsed;
        }
        window.menuIPC = {
          on: (event, listener) => {
            listeners[event] = listener;
          },
          invoke: async (event) =>
            event === 'get-menu'
              ? {
                  items: [
                    {
                      label: 'Options',
                      visible: true,
                      commandId: 1,
                      submenu: {
                        items: [
                          {
                            label: 'Example setting',
                            type: 'normal',
                            visible: true,
                            commandId: 2,
                          },
                        ],
                      },
                    },
                  ],
                }
              : false,
        };
        window.toggleMenu = () => listeners['toggle-in-app-menu']();
      },
      { collapsed, hideBarWhenCollapsed, userAgent },
    );
    await window.addScriptTag({ content: renderer });
    await window.evaluate(() =>
      window.inAppMenu.onRendererLoad({
        getConfig: () => ({
          ...window.inAppMenu.defaultInAppMenuConfig,
          ...window.menuConfig,
        }),
        ipc: window.menuIPC,
      }),
    );
    return { app, window, bar: window.locator('#ytmd-title-bar-main-panel') };
  } catch (error) {
    await app.close();
    throw error;
  }
}

async function expectContentOffset(window, pixels) {
  await expect(window.locator('#content')).toHaveCSS(
    'padding-top',
    `${pixels}px`,
  );
  await expect(window.locator('#layout')).toHaveCSS(
    'height',
    `${(await window.evaluate(() => innerHeight)) - pixels}px`,
  );
}

test('collapsed bar reclaims its space and can be restored through the menu shortcut IPC', async ({}, testInfo) => {
  const { app, window, bar } = await launch(testInfo, {
    hideBarWhenCollapsed: true,
  });
  try {
    await expect(bar).toBeHidden();
    await expectContentOffset(window, 0);
    await window.evaluate(() => window.toggleMenu());
    await expect(bar).toBeVisible();
    await expectContentOffset(window, 32);
    await window.evaluate(() => {
      document
        .querySelector('ytmusic-player')
        .setAttribute('player-ui-state', 'FULLSCREEN');
      window.dispatchEvent(new MouseEvent('mousemove', { clientY: 200 }));
    });
    await expect(bar).toHaveCSS('transform', 'none');
    await bar.getByText('Options', { exact: true }).click();
    await expect(
      window.getByText('Example setting', { exact: true }),
    ).toBeVisible();
    await window.evaluate(() => window.toggleMenu());
    await expect(bar).toBeHidden();
    await expectContentOffset(window, 0);
    await expect(
      window.getByText('Example setting', { exact: true }),
    ).toBeHidden();
  } finally {
    await app.close();
  }
});

test('default settings retain the bar when the menu is collapsed', async ({}, testInfo) => {
  const { app, window, bar } = await launch(testInfo);
  try {
    await expect(bar).toBeVisible();
    await expectContentOffset(window, 32);
    await window.evaluate(() => window.toggleMenu());
    await expect(bar.getByText('Options', { exact: true })).toBeVisible();
    await window.evaluate(() => {
      document
        .querySelector('ytmusic-player')
        .setAttribute('player-ui-state', 'FULLSCREEN');
      window.dispatchEvent(new MouseEvent('mousemove', { clientY: 200 }));
    });
    await expect(bar).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, -32)');
    await window.evaluate(() => {
      document
        .querySelector('ytmusic-player')
        .removeAttribute('player-ui-state');
    });
    await expect(bar).toHaveCSS('transform', 'none');
    await bar.locator('button').first().click();
    await expect(bar.getByText('Options', { exact: true })).toBeHidden();
    await expect(bar).toBeVisible();
    await expectContentOffset(window, 32);
  } finally {
    await app.close();
  }
});

test('changing the setting takes effect without a restart', async ({}, testInfo) => {
  const { app, window, bar } = await launch(testInfo, {
    hideBarWhenCollapsed: false,
  });
  try {
    await expect(bar).toBeVisible();
    await window.evaluate(() =>
      window.inAppMenu.onConfigChange({
        ...window.menuConfig,
        hideBarWhenCollapsed: true,
      }),
    );
    await expect(bar).toBeHidden();
    await expectContentOffset(window, 0);
    await window.evaluate(() =>
      window.inAppMenu.onConfigChange(window.menuConfig),
    );
    await expect(bar).toBeVisible();
    await expectContentOffset(window, 32);
  } finally {
    await app.close();
  }
});

for (const userAgent of ['Windows', 'Macintosh']) {
  test(`retains the bar in the ${userAgent} renderer`, async ({}, testInfo) => {
    const { app, window, bar } = await launch(testInfo, {
      hideBarWhenCollapsed: true,
      userAgent,
    });
    try {
      await expect(bar).toBeVisible();
      await expectContentOffset(window, 32);
    } finally {
      await app.close();
    }
  });
}
