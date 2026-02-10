import { register } from 'electron-localshortcut';

import {
  BrowserWindow,
  Menu,
  type MenuItem,
  ipcMain,
  nativeImage,
  type WebContents,
} from 'electron';

import type { BackendContext } from '@/types/contexts';
import type { InAppMenuConfig } from './constants';

export const onMainLoad = ({
  window: win,
  ipc: { handle, send },
}: BackendContext<InAppMenuConfig>) => {
  win.on('close', () => {
    send('close-all-in-app-menu-panel');
  });

  win.once('ready-to-show', () => {
    register(win, '`', () => {
      send('toggle-in-app-menu');
    });
  });

  handle('get-menu', () =>
    JSON.parse(
      JSON.stringify(
        Menu.getApplicationMenu(),
        (key: string, value: unknown) =>
          key !== 'commandsMap' && key !== 'menu' ? value : undefined,
      ),
    ),
  );

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

  ipcMain.handle('peard:menu-event', (event, commandId: number) => {
    const target = getMenuItemById(commandId);
    if (target)
      (
        target.click as (
          args0: unknown,
          args1: BrowserWindow | null,
          args3: WebContents,
        ) => void
      )(undefined, BrowserWindow.fromWebContents(event.sender), event.sender);
  });

  handle('get-menu-by-id', (commandId: number) => {
    const result = getMenuItemById(commandId);

    return JSON.parse(
      JSON.stringify(result, (key: string, value: unknown) =>
        key !== 'commandsMap' && key !== 'menu' ? value : undefined,
      ),
    );
  });

  handle('window-is-maximized', () => win.isMaximized());

  handle('window-close', () => win.close());
  handle('window-minimize', () => win.minimize());
  handle('window-maximize', () => win.maximize());
  win.on('maximize', () => send('window-maximize'));
  handle('window-unmaximize', () => win.unmaximize());
  win.on('unmaximize', () => send('window-unmaximize'));

  handle('image-path-to-data-url', (imagePath: string) => {
    const nativeImageIcon = nativeImage.createFromPath(imagePath);
    return nativeImageIcon?.toDataURL();
  });
};
