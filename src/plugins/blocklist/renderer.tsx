import { t } from '@/i18n';
import {
  isMusicOrVideoTrack,
  isPlayerMenu,
} from '@/plugins/utils/renderer/check';
import { getSongMenu } from '@/providers/dom-elements';
import { getSongInfo } from '@/providers/song-info-front';

import { createBlockButton } from './templates/block-button';

import type { BlockedArtist, BlocklistPluginConfig } from './index';
import type { RendererContext } from '@/types/contexts';
import type { MusicPlayer } from '@/types/music-player';
import type { VideoDataChangeValue } from '@/types/player-api-events';

let config: BlocklistPluginConfig = { enabled: true, blockedArtists: [] };
let setConfig: RendererContext<BlocklistPluginConfig>['setConfig'] = () => {};
let api: MusicPlayer | null = null;

// Artist channel ids start with "UC" (albums/playlists use MPRE/VL/PL instead),
// so this only matches links that point at an artist.
const ARTIST_ID = /(?:channel|browse)\/(UC[0-9A-Za-z_-]+)/;
const parseChannelId = (href?: string | null) => href?.match(ARTIST_ID)?.[1];

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

  // Fall back to the author name when a videoId is missing so the cooldown
  // still guards against a runaway skip loop.
  const key = videoId || author;
  if (!key) return true;

  const now = Date.now();
  for (const [id, at] of recentSkipAttempts) {
    if (now - at > SKIP_COOLDOWN_MS) recentSkipAttempts.delete(id);
  }

  const lastAttempt = recentSkipAttempts.get(key);
  if (lastAttempt !== undefined && now - lastAttempt < SKIP_COOLDOWN_MS) {
    return false;
  }

  recentSkipAttempts.set(key, now);
  return true;
};

const skipIfBlocked = (author?: string | null, videoId?: string | null) => {
  if (shouldSkip(author, videoId)) {
    api?.nextVideo();
    return true;
  }
  return false;
};

// Tracks queue position so forward playback can be told apart from a deliberate
// backward navigation (e.g. the user pressing Previous).
let lastPlaylistIndex = -1;

const onVideoDataChange = (
  name: 'dataloaded' | 'dataupdated',
  data: VideoDataChangeValue,
) => {
  if (name !== 'dataloaded') return;

  const index = api?.getPlaylistIndex();
  const wentBackward =
    typeof index === 'number' &&
    lastPlaylistIndex >= 0 &&
    index < lastPlaylistIndex;
  if (typeof index === 'number') lastPlaylistIndex = index;

  // Respect a deliberate back-navigation: if the user moved backward onto this
  // track (e.g. pressed Previous), let it play even if the artist is blocked.
  // One-time only — a later forward play of the same artist still gets skipped.
  if (wentBackward) return;

  skipIfBlocked(data?.author, data?.videoId);
};

/* ---- resolving which artist(s) a menu targets ---- */

const dedupeArtists = (artists: BlockedArtist[]): BlockedArtist[] => {
  const seen = new Set<string>();
  const result: BlockedArtist[] = [];
  for (const artist of artists) {
    const key = (artist.channelId ?? artist.name).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(artist);
  }
  return result;
};

// Resolve an artist's display name from its channel id. A menu item's own
// text is the action label ("Go to artist"), never the artist name, so read
// the name from a link to that same channel on the underlying page (the song
// row or artist card that opened the menu). Links inside the popup are skipped
// so we don't read the "Go to artist" label back as the name.
const resolveArtistName = (channelId: string): string | undefined => {
  for (const link of document.querySelectorAll<HTMLAnchorElement>(
    `a[href*="${channelId}"]`,
  )) {
    if (link.closest('ytmusic-popup-container')) continue;
    const name = link.textContent?.trim();
    if (name) return name;
  }
  return undefined;
};

// "Go to artist" links inside the open popup menu (works for song rows).
const getMenuLinkedArtists = (menu: HTMLElement): BlockedArtist[] => {
  const artists: BlockedArtist[] = [];
  for (const item of menu.querySelectorAll<HTMLElement>(
    'ytmusic-menu-navigation-item-renderer',
  )) {
    const channelId = parseChannelId(
      item.querySelector('#navigation-endpoint')?.getAttribute('href'),
    );
    if (!channelId) continue;
    const name = resolveArtistName(channelId);
    if (name) artists.push({ name, channelId });
  }
  return artists;
};

// Every artist listed in the now-playing bar byline (full multi-artist list).
const getPlayerBarArtists = (): BlockedArtist[] => {
  const artists: BlockedArtist[] = [];
  for (const link of document.querySelectorAll<HTMLAnchorElement>(
    'ytmusic-player-bar a.yt-simple-endpoint[href]',
  )) {
    const channelId = parseChannelId(link.getAttribute('href'));
    const name = link.textContent?.trim();
    if (channelId && name) artists.push({ name, channelId });
  }
  return artists;
};

const getMenuArtists = (menu: HTMLElement): BlockedArtist[] => {
  // The now-playing bar menu exposes the full artist list via the byline.
  if (isPlayerMenu(menu)) {
    const byline = getPlayerBarArtists();
    if (byline.length) return dedupeArtists(byline);
  }

  // Any menu with "Go to artist" links (song rows, player bar, …).
  const linked = getMenuLinkedArtists(menu);
  if (linked.length) return dedupeArtists(linked);

  // A track menu with no artist link — fall back to the current song's artist.
  if (isMusicOrVideoTrack() || isPlayerMenu(menu)) {
    const info = getSongInfo();
    if (info?.artist) {
      return [{ name: info.artist, channelId: parseChannelId(info.artistUrl) }];
    }
  }

  return [];
};

/* ---- blocking + menu injection ---- */

const blockArtist = (artist: BlockedArtist) => {
  if (!isBlocked(artist.name)) {
    const blockedArtists = [...config.blockedArtists, artist];
    config = { ...config, blockedArtists };
    setConfig({ blockedArtists });
  }

  // Close the popup, then skip the current song if it is now blocked.
  document
    .querySelector<HTMLElement & { close?: () => void }>(
      'ytmusic-popup-container tp-yt-iron-dropdown',
    )
    ?.close?.();

  const current = getSongInfo();
  skipIfBlocked(current?.artist, current?.videoId);
};

const injectBlockButtons = () => {
  const menu = getSongMenu();
  if (!menu) return;

  const artists = getMenuArtists(menu);
  const key = artists.map((artist) => artist.channelId ?? artist.name).join('|');
  const existing = menu.querySelector<HTMLElement>('.blocklist-injected');

  if (!artists.length) {
    if (existing) {
      menu.querySelectorAll('.blocklist-injected').forEach((el) => el.remove());
    }
    return;
  }

  if (existing?.dataset.blocklistKey === key) return;
  menu.querySelectorAll('.blocklist-injected').forEach((el) => el.remove());

  const fragment = document.createDocumentFragment();
  for (const artist of artists) {
    const button = createBlockButton(
      t('plugins.blocklist.templates.button', { name: artist.name }),
      () => blockArtist(artist),
    );
    button.dataset.blocklistKey = key;
    fragment.append(button);
  }
  menu.prepend(fragment);
};

const menuObserver = new MutationObserver(injectBlockButtons);

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

  // A blocked song might already be loaded when the plugin starts.
  const current = getSongInfo();
  skipIfBlocked(current?.artist, current?.videoId);
  playerApi.addEventListener('videodatachange', onVideoDataChange);

  const popupContainer = document.querySelector('ytmusic-popup-container');
  if (popupContainer) {
    menuObserver.observe(popupContainer, { childList: true, subtree: true });
  }
};

export const stop = () => {
  menuObserver.disconnect();
  recentSkipAttempts.clear();
  lastPlaylistIndex = -1;
  api?.removeEventListener('videodatachange', onVideoDataChange);
  getSongMenu()
    ?.querySelectorAll('.blocklist-injected')
    .forEach((el) => el.remove());
  api = null;
};
