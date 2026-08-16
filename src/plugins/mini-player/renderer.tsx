import { render } from 'solid-js/web';

import { t } from '@/i18n';
import {
  isMusicOrVideoTrack,
  isPlayerMenu,
} from '@/plugins/utils/renderer/check';
import { getSongMenu } from '@/providers/dom-elements';

import { MiniPlayerButton } from './templates/mini-player-button';

import type { MiniPlayerPluginConfig } from './index';
import type { RendererContext } from '@/types/contexts';
import type { MusicPlayer } from '@/types/music-player';

let observer: MutationObserver | null = null;
let container: HTMLElement | null = null;
let disposeButton: (() => void) | null = null;

/**
 * Close the popup this entry lives in, scoped to the element that was clicked.
 * A document-wide `#icon` lookup would hit the first icon on the page, which
 * belongs to an unrelated button — that id is not unique here.
 */
const closeSongMenu = (target: EventTarget | null) => {
  if (!(target instanceof Element)) {
    return;
  }

  const popup = target.closest<HTMLElement & { close?: () => void }>(
    'tp-yt-iron-dropdown',
  );

  if (popup?.close) {
    popup.close();
    return;
  }

  // Fall back to the key the dropdown closes on anyway.
  target.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      composed: true,
    }),
  );
};

/**
 * Adds an entry to the player's song menu, mirroring what picture-in-picture
 * does. If YouTube Music ever renames these nodes the entry simply stops
 * appearing — the hotkey and the plugin menu keep working.
 */
export const onPlayerApiReady = (
  _: MusicPlayer,
  { ipc }: RendererContext<MiniPlayerPluginConfig>,
) => {
  const popupContainer = document.querySelector('ytmusic-popup-container');
  if (!popupContainer || container) {
    return;
  }

  container = document.createElement('div');
  container.classList.add(
    'style-scope',
    'menu-item',
    'ytmusic-menu-popup-renderer',
  );
  container.setAttribute('aria-disabled', 'false');
  container.setAttribute('aria-selected', 'false');
  container.setAttribute('role', 'option');
  container.setAttribute('tabindex', '-1');

  disposeButton = render(
    () => (
      <MiniPlayerButton
        onClick={(event) => {
          ipc.send('plugin:toggle-mini-player');
          closeSongMenu(event.currentTarget);
        }}
        text={t('plugins.mini-player.templates.button')}
      />
    ),
    container,
  );

  observer = new MutationObserver(() => {
    const menu = getSongMenu();

    if (
      !container ||
      menu?.contains(container) ||
      !isMusicOrVideoTrack() ||
      !isPlayerMenu(menu)
    ) {
      return;
    }

    menu?.prepend(container);
  });

  observer.observe(popupContainer, { childList: true, subtree: true });
};

export const onRendererUnload = () => {
  observer?.disconnect();
  observer = null;

  disposeButton?.();
  disposeButton = null;

  container?.remove();
  container = null;
};
