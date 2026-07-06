import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';

import { t } from '@/i18n';
import { isMusicOrVideoTrack } from '@/plugins/utils/renderer/check';
import { getSongMenu } from '@/providers/dom-elements';
import { getSongInfo } from '@/providers/song-info-front';

import { BlockArtistButton } from './templates/block-button';

import type { BlockedArtist, BlocklistPluginConfig } from './index';
import type { RendererContext } from '@/types/contexts';
import type { MusicPlayer } from '@/types/music-player';
import type { VideoDataChangeValue } from '@/types/player-api-events';

let config: BlocklistPluginConfig = { enabled: true, blockedArtists: [] };
let setConfig: RendererContext<BlocklistPluginConfig>['setConfig'] = () => {};
let api: MusicPlayer | null = null;

let buttonContainer: HTMLDivElement | null = null;
let disposeButton: (() => void) | null = null;

const [buttonText, setButtonText] = createSignal('');

/** Normalize an artist name for matching (drop the " - Topic" suffix, casefold). */
const normalize = (name: string) =>
  name
    .normalize('NFC')
    .replace(/\s*-\s*topic\s*$/i, '')
    .trim()
    .toLowerCase();

/** Split a combined author string into individual artists (collaborations). */
const splitArtists = (author: string) =>
  author
    .split(/,|&|、|·|\/|(?:\s(?:feat\.?|ft\.?|x|×|vs\.?)\s)/i)
    .map((part) => part.trim())
    .filter(Boolean);

const isBlocked = (author?: string | null) => {
  if (!author) return false;
  const whole = normalize(author);
  const parts = splitArtists(author).map(normalize);
  return config.blockedArtists.some((artist) => {
    const target = normalize(artist.name);
    return target.length > 0 && (whole === target || parts.includes(target));
  });
};

// If a skip does not "stick" (e.g. a Music Together host controls playback and
// re-syncs us back to the same song), give up instead of fighting in a loop.
const SKIP_COOLDOWN_MS = 5000;
const recentSkipAttempts = new Map<string, number>();

const shouldSkip = (author?: string | null, videoId?: string | null) => {
  if (!isBlocked(author)) return false;
  if (!videoId) return true;

  const now = Date.now();
  for (const [id, at] of recentSkipAttempts) {
    if (now - at > SKIP_COOLDOWN_MS) recentSkipAttempts.delete(id);
  }

  const lastAttempt = recentSkipAttempts.get(videoId);
  if (lastAttempt !== undefined && now - lastAttempt < SKIP_COOLDOWN_MS) {
    // We already tried to skip this exact track and it came back — something
    // else controls playback (e.g. a Music Together session). Stop fighting it.
    return false;
  }

  recentSkipAttempts.set(videoId, now);
  return true;
};

const skipIfBlocked = (author?: string | null, videoId?: string | null) => {
  if (shouldSkip(author, videoId)) {
    api?.nextVideo();
    return true;
  }
  return false;
};

const onVideoDataChange = (
  name: 'dataloaded' | 'dataupdated',
  data: VideoDataChangeValue,
) => {
  if (name !== 'dataloaded') return;
  skipIfBlocked(data?.author, data?.videoId);
};

/**
 * Resolve the artist for the song the currently-open context menu targets.
 * Prefers the menu's "Go to artist" navigation item (works for any song row),
 * and falls back to the currently-playing song (the player-bar menu).
 */
const getMenuArtist = (): BlockedArtist | null => {
  const menu = getSongMenu();
  if (menu) {
    for (const item of menu.querySelectorAll<HTMLElement>(
      'ytmusic-menu-navigation-item-renderer',
    )) {
      const href = item
        .querySelector('#navigation-endpoint')
        ?.getAttribute('href');
      // Artist pages look like "channel/UC..."; albums use "browse/..." instead.
      if (href?.startsWith('channel/')) {
        const name = item
          .querySelector<HTMLElement>('.text')
          ?.textContent?.trim();
        if (name) return { name, channelId: href.slice('channel/'.length) };
      }
    }
  }

  const info = getSongInfo();
  if (info?.artist) {
    return {
      name: info.artist,
      channelId: info.artistUrl?.split('/channel/')[1],
    };
  }

  return null;
};

const blockFromMenu = () => {
  const artist = getMenuArtist();
  if (!artist) return;

  if (!isBlocked(artist.name)) {
    const blockedArtists = [...config.blockedArtists, artist];
    config = { ...config, blockedArtists };
    setConfig({ blockedArtists });
  }

  // Close the popup menu, then skip the current song if it is now blocked.
  document
    .querySelector<HTMLElement & { close?: () => void }>(
      'ytmusic-popup-container tp-yt-iron-dropdown',
    )
    ?.close?.();

  const current = getSongInfo();
  skipIfBlocked(current?.artist, current?.videoId);
};

const menuObserver = new MutationObserver(() => {
  const menu = getSongMenu();
  if (
    !menu ||
    !buttonContainer ||
    menu.contains(buttonContainer) ||
    !isMusicOrVideoTrack()
  ) {
    return;
  }

  menu.prepend(buttonContainer);
});

export const onRendererLoad = async (
  context: RendererContext<BlocklistPluginConfig>,
) => {
  setConfig = context.setConfig;
  config = await context.getConfig();
};

export const onConfigChange = (newConfig: BlocklistPluginConfig) => {
  config = newConfig;
};

export const onPlayerApiReady = (
  playerApi: MusicPlayer,
  _context: RendererContext<BlocklistPluginConfig>,
) => {
  api = playerApi;
  setButtonText(t('plugins.blocklist.templates.button'));

  buttonContainer = document.createElement('div');
  buttonContainer.classList.add(
    'blocklist-menu-item',
    'style-scope',
    'menu-item',
    'ytmusic-menu-popup-renderer',
  );
  buttonContainer.setAttribute('role', 'option');
  buttonContainer.setAttribute('tabindex', '-1');

  disposeButton = render(
    () => <BlockArtistButton onClick={blockFromMenu} text={buttonText()} />,
    buttonContainer,
  );

  const popupContainer = document.querySelector('ytmusic-popup-container');
  if (popupContainer) {
    menuObserver.observe(popupContainer, { childList: true, subtree: true });
  }

  // A blocked song might already be loaded when the plugin starts.
  const current = getSongInfo();
  skipIfBlocked(current?.artist, current?.videoId);
  playerApi.addEventListener('videodatachange', onVideoDataChange);
};

export const stop = () => {
  menuObserver.disconnect();
  recentSkipAttempts.clear();
  api?.removeEventListener('videodatachange', onVideoDataChange);
  disposeButton?.();
  disposeButton = null;
  buttonContainer?.remove();
  buttonContainer = null;
  api = null;
};
