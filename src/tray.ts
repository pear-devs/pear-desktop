import { Menu, nativeImage, screen, Tray } from 'electron';
import is from 'electron-is';

import TrayIcon from '@assets/tray.png?asset&asarUnpack';
import PausedTrayIcon from '@assets/tray-paused.png?asset&asarUnpack';
import TrayIconWhite from '@assets/tray-white.png?asset&asarUnpack';
import PausedTrayIconWhite from '@assets/tray-paused-white.png?asset&asarUnpack';

import * as config from './config';

import { restart } from './providers/app-controls';
import { registerCallback, SongInfoEvent } from './providers/song-info';
import { getSongControls } from './providers/song-controls';

import { APPLICATION_NAME, t } from '@/i18n';

import type { MenuTemplate } from './menu';

// Prevent tray being garbage collected
let tray: Electron.Tray | undefined;

type TrayEvent = (
  event: Electron.KeyboardEvent,
  bounds: Electron.Rectangle,
) => void;

export const setTrayOnClick = (fn: TrayEvent) => {
  if (!tray) {
    return;
  }

  tray.removeAllListeners('click');
  tray.on('click', fn);
};

// Won't do anything on macOS since its disabled
export const setTrayOnDoubleClick = (fn: TrayEvent) => {
  if (!tray) {
    return;
  }

  tray.removeAllListeners('double-click');
  tray.on('double-click', fn);
};

export const setUpTray = (app: Electron.App, win: Electron.BrowserWindow) => {
  if (!config.get('options.tray')) {
    tray = undefined;
    return;
  }

  const { playPause, next, previous } = getSongControls(win);

  const pixelRatio = is.windows()
    ? screen.getPrimaryDisplay().scaleFactor || 1
    : 1;

  const defaultTrayIcon = nativeImage
    .createFromPath(is.macOS() ? TrayIconWhite : TrayIcon)
    .resize({
      width: 16 * pixelRatio,
      height: 16 * pixelRatio,
    });
  const pausedTrayIcon = nativeImage
    .createFromPath(is.macOS() ? PausedTrayIconWhite : PausedTrayIcon)
    .resize({
      width: 16 * pixelRatio,
      height: 16 * pixelRatio,
    });

  tray = new Tray(defaultTrayIcon);

  tray.setToolTip(
    t('main.tray.tooltip.default', {
      applicationName: APPLICATION_NAME,
    }),
  );

  // MacOS only
  tray.setIgnoreDoubleClickEvents(true);

  tray.on('click', () => {
    if (config.get('options.trayClickPlayPause')) {
      playPause();
    } else if (win.isVisible()) {
      win.hide();
      app.dock?.hide();
    } else {
      win.show();
      app.dock?.show();
    }
  });

  const template: MenuTemplate = [
    {
      label: t('main.tray.play-pause'),
      click() {
        playPause();
      },
    },
    {
      label: t('main.tray.next'),
      click() {
        next();
      },
    },
    {
      label: t('main.tray.previous'),
      click() {
        previous();
      },
    },
    {
      label: t('main.tray.show'),
      click() {
        win.show();
        app.dock?.show();
      },
    },
    { type: 'separator' },
    {
      label: t('main.tray.restart'),
      click: restart,
    },
    { type: 'separator' },
    {
      label: t('main.tray.quit'),
      role: 'quit',
    },
  ];

  const trayMenu = Menu.buildFromTemplate(template);
  tray.setContextMenu(trayMenu);

  registerCallback((songInfo, event) => {
    if (event === SongInfoEvent.TimeChanged) return;

    if (tray) {
      if (typeof songInfo.isPaused === 'undefined') {
        tray.setImage(defaultTrayIcon);
        return;
      }

      tray.setToolTip(
        t('main.tray.tooltip.with-song-info', {
          artist: songInfo.artist,
          title: songInfo.title,
          applicationName: APPLICATION_NAME,
        }),
      );

      tray.setImage(songInfo.isPaused ? pausedTrayIcon : defaultTrayIcon);
    }
  });
};
