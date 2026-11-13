import { app } from 'electron';

import { createBackend } from '@/utils';

import type { PictureInPictureIpc, pictureInPictureConfig } from './types';

export default createBackend<
  typeof pictureInPictureConfig,
  PictureInPictureIpc
>((ctx) => {
  const { window } = ctx;
  let isInPiP = false;
  let originalPosition: number[];
  let originalSize: number[];
  let originalFullScreen: boolean;
  let originalMaximized: boolean;

  const pipPosition = () =>
    (ctx.config.savePosition && ctx.config['pip-position']) || [10, 10];
  const pipSize = () =>
    (ctx.config.saveSize && ctx.config['pip-size']) || [450, 275];

  const togglePiP = () => {
    isInPiP = !isInPiP;
    ctx.setConfig({ isInPiP });

    if (isInPiP) {
      originalFullScreen = window.isFullScreen();
      if (originalFullScreen) {
        window.setFullScreen(false);
      }

      originalMaximized = window.isMaximized();
      if (originalMaximized) {
        window.unmaximize();
      }

      originalPosition = window.getPosition();
      originalSize = window.getSize();

      window.webContents.addListener('before-input-event', blockShortcutsInPiP);

      window.setMaximizable(false);
      window.setFullScreenable(false);

      ctx.ipc.send('pipToggle', true);

      app.dock?.hide();
      window.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
      });
      app.dock?.show();
      if (ctx.config.alwaysOnTop) {
        window.setAlwaysOnTop(true, 'screen-saver', 1);
      }
    } else {
      window.webContents.removeListener(
        'before-input-event',
        blockShortcutsInPiP,
      );
      window.setMaximizable(true);
      window.setFullScreenable(true);

      ctx.ipc.send('pipToggle', false);

      window.setVisibleOnAllWorkspaces(false);
      window.setAlwaysOnTop(false);

      if (originalFullScreen) {
        window.setFullScreen(true);
      }

      if (originalMaximized) {
        window.maximize();
      }
    }

    const [x, y] = isInPiP ? pipPosition() : originalPosition;
    const [w, h] = isInPiP ? pipSize() : originalSize;
    window.setPosition(x, y);
    window.setSize(w, h);

    window.setWindowButtonVisibility?.(!isInPiP);
  };

  const blockShortcutsInPiP = (
    event: Electron.Event,
    input: Electron.Input,
  ) => {
    const key = input.key.toLowerCase();

    if (key === 'f') {
      event.preventDefault();
    } else if (key === 'escape') {
      togglePiP();
      event.preventDefault();
    }
  };

  ctx.setConfig({ isInPiP });
  ctx.ipc.on('toggle', togglePiP);

  ctx.listen(window, 'move', () => {
    if (ctx.config.isInPiP && !ctx.config.useNativePiP) {
      const [x, y] = window.getPosition();
      ctx.setConfig({ 'pip-position': [x, y] });
    }
  });

  ctx.listen(window, 'resize', () => {
    if (ctx.config.isInPiP && !ctx.config.useNativePiP) {
      const [width, height] = window.getSize();
      ctx.setConfig({ 'pip-size': [width, height] });
    }
  });

  // Options are read when used; only "always on top" applies at once.
  ctx.onConfigChange((config, previous) => {
    if (config.alwaysOnTop !== previous.alwaysOnTop) {
      window.setAlwaysOnTop(config.alwaysOnTop);
    }
  });

  // Leave PiP (restoring the window) when the plugin stops.
  ctx.onCleanup(() => {
    if (isInPiP && !window.isDestroyed()) togglePiP();
  });
});
