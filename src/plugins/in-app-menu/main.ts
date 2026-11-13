import {
  type BrowserWindow,
  Menu,
  type MenuItem,
  type WebContents,
} from 'electron';
import { register, unregister } from 'electron-localshortcut';

import { createBackend } from '@/utils';

import type { InAppMenuIpc, inAppMenuConfig } from './types';

const TOGGLE_SHORTCUT = '`';

/** A menu (item) as plain data the renderer can receive. */
const serialize = <T>(value: T): T =>
  JSON.parse(
    JSON.stringify(value, (key: string, it: unknown) =>
      key !== 'commandsMap' && key !== 'menu' ? it : undefined,
    ),
  ) as T;

export default createBackend<typeof inAppMenuConfig, InAppMenuIpc>((ctx) => {
  const { window: win, ipc } = ctx;

  ctx.listen(win, 'close', () => {
    ipc.send('closeAllPanels');
  });

  let shortcutRegistered = false;
  ctx.listen(win, 'ready-to-show', () => {
    if (shortcutRegistered) return;
    shortcutRegistered = true;
    register(win, TOGGLE_SHORTCUT, () => {
      ipc.send('toggleMenu');
    });
  });
  ctx.onCleanup(() => {
    if (shortcutRegistered && !win.isDestroyed()) {
      unregister(win, TOGGLE_SHORTCUT);
    }
  });

  ipc.handle('getMenu', () => serialize(Menu.getApplicationMenu()));

  const getMenuItemById = (commandId: number): MenuItem | null => {
    const menu = Menu.getApplicationMenu();

    let target: MenuItem | null = null;
    const stack = [...(menu?.items ?? [])];
    while (stack.length > 0) {
      const now = stack.shift();
      now?.submenu?.items.forEach((item) => stack.push(item));

      if (now?.commandId === commandId) {
        target = now;
        break;
      }
    }

    return target;
  };

  ipc.handle('menuEvent', (commandId) => {
    const target = getMenuItemById(commandId);
    if (target)
      (
        target.click as (
          args0: unknown,
          args1: BrowserWindow | null,
          args3: WebContents,
        ) => void
      )(undefined, win, win.webContents);
  });

  ipc.handle('getMenuById', (commandId) =>
    serialize(getMenuItemById(commandId)),
  );

  ipc.handle('windowIsMaximized', () => win.isMaximized());

  ipc.handle('windowClose', () => win.close());
  ipc.handle('windowMinimize', () => win.minimize());
  ipc.handle('windowMaximize', () => win.maximize());
  ctx.listen(win, 'maximize', () => ipc.send('maximized'));
  ipc.handle('windowUnmaximize', () => win.unmaximize());
  ctx.listen(win, 'unmaximize', () => ipc.send('unmaximized'));
});
