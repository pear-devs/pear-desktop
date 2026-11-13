import { toKeyEvent } from 'keyboardevent-from-electron-accelerator';
import keyEventAreEqual from 'keyboardevents-areequal';
import { render } from 'solid-js/web';

import { t } from '@/i18n';
import {
  isMusicOrVideoTrack,
  isPlayerMenu,
} from '@/plugins/utils/renderer/check';
import { getSongMenu } from '@/providers/dom-elements';
import { createRenderer } from '@/utils';

import { PictureInPictureButton } from './templates/picture-in-picture-button';

import type { PictureInPictureIpc, pictureInPictureConfig } from './types';

export default createRenderer<
  typeof pictureInPictureConfig,
  PictureInPictureIpc
>((ctx) => {
  // Options are read when used.
  ctx.onConfigChange(() => {});

  ctx.onPlayerApiReady(() => {
    const togglePictureInPicture = async () => {
      if (ctx.config.useNativePiP) {
        const isInPiP = document.pictureInPictureElement !== null;
        const video = document.querySelector<HTMLVideoElement>('video');
        const togglePiP = () =>
          isInPiP
            ? document.exitPictureInPicture()
            : video?.requestPictureInPicture();

        try {
          await togglePiP();
          document.querySelector<HTMLButtonElement>('#icon')?.click(); // Close the menu
          return true;
        } catch {}
      }

      ctx.ipc.send('toggle');
      return false;
    };

    ctx.listen(window, 'keydown', (event) => {
      const { hotkey } = ctx.config;
      if (
        hotkey &&
        keyEventAreEqual(event, toKeyEvent(hotkey)) &&
        !document.querySelector<HTMLElement & { opened: boolean }>(
          'ytmusic-search-box',
        )?.opened
      ) {
        togglePictureInPicture();
      }
    });

    const exitFullScreenButton = document.querySelector<HTMLButtonElement>(
      '.exit-fullscreen-button',
    );
    const getPlayMinimizeButton = () =>
      document.querySelector('.player-minimize-button');
    const appLayout = document.querySelector<HTMLElement>('ytmusic-app-layout');
    const expandMenu = document.querySelector<HTMLElement>('#expanding-menu');
    const middleControls =
      document.querySelector<HTMLButtonElement>('.middle-controls');
    const playerPage = document.querySelector<
      HTMLElement & { playerPageOpen_: boolean }
    >('ytmusic-player-page');
    const togglePlayerPageButton = document.querySelector<HTMLButtonElement>(
      '.toggle-player-page-button',
    );
    const fullScreenButton =
      document.querySelector<HTMLButtonElement>('.fullscreen-button');
    const player = document.querySelector<
      HTMLVideoElement & { onDoubleClick_: (() => void) | undefined }
    >('#player');
    const onPlayerDblClick = player?.onDoubleClick_;
    const mouseLeaveEventListener = () => middleControls?.click();

    const titleBar = document.querySelector<HTMLElement>(
      'nav[data-ytmd-main-panel]',
    );

    const pipClickEventListener = async (e: Event) => {
      e.stopPropagation();
      e.preventDefault();
      await togglePictureInPicture();
    };

    const setPiP = (isPip: boolean) => {
      if (!exitFullScreenButton || !player) return;
      if (isPip) {
        exitFullScreenButton.addEventListener('click', pipClickEventListener);
        getPlayMinimizeButton()?.removeEventListener(
          'click',
          pipClickEventListener,
        );
        player.onDoubleClick_ = () => {};

        expandMenu?.addEventListener('mouseleave', mouseLeaveEventListener);
        if (!playerPage?.playerPageOpen_) {
          togglePlayerPageButton?.click();
        }

        fullScreenButton?.click();
        appLayout?.classList.add('pip');
        if (titleBar) {
          titleBar.style.display = 'none';
        }
      } else {
        exitFullScreenButton.removeEventListener(
          'click',
          pipClickEventListener,
        );
        getPlayMinimizeButton()?.addEventListener(
          'click',
          pipClickEventListener,
        );
        player.onDoubleClick_ = onPlayerDblClick;
        expandMenu?.removeEventListener('mouseleave', mouseLeaveEventListener);
        exitFullScreenButton.click();
        appLayout?.classList.remove('pip');
        if (titleBar) {
          titleBar.style.display = 'flex';
        }
      }
    };

    let isPip = false;
    ctx.ipc.on('pipToggle', (value) => {
      isPip = value;
      setPiP(value);
    });
    ctx.onCleanup(() => {
      if (isPip) setPiP(false);
      getPlayMinimizeButton()?.removeEventListener(
        'click',
        pipClickEventListener,
      );
    });

    getPlayMinimizeButton()?.addEventListener('click', pipClickEventListener);

    const pipButtonContainer = document.createElement('div');
    pipButtonContainer.classList.add(
      'style-scope',
      'menu-item',
      'ytmusic-menu-popup-renderer',
    );
    pipButtonContainer.setAttribute('aria-disabled', 'false');
    pipButtonContainer.setAttribute('aria-selected', 'false');
    pipButtonContainer.setAttribute('role', 'option');
    pipButtonContainer.setAttribute('tabindex', '-1');

    const dispose = render(
      () => (
        <PictureInPictureButton
          onClick={togglePictureInPicture}
          text={t('plugins.picture-in-picture.templates.button')}
        />
      ),
      pipButtonContainer,
    );
    ctx.onCleanup(() => {
      dispose();
      pipButtonContainer.remove();
    });

    const popupContainer = document.querySelector('ytmusic-popup-container');
    if (popupContainer) {
      ctx.observe(popupContainer, { childList: true, subtree: true }, () => {
        const menu = getSongMenu();

        if (
          menu?.contains(pipButtonContainer) ||
          !isMusicOrVideoTrack() ||
          !isPlayerMenu(menu)
        ) {
          return;
        }

        menu?.prepend(pipButtonContainer);
      });
    }
  });
});
