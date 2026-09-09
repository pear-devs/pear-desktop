import { render } from 'solid-js/web';

import { t } from '@/i18n';
import {
  isMusicOrVideoTrack,
  isPlayerMenu,
} from '@/plugins/utils/renderer/check';
import { getSongMenu } from '@/providers/dom-elements';
import { getSongInfo } from '@/providers/song-info-front';
import { waitForElement } from '@/utils/wait-for-element';

import { uniqueNormalized } from './match';
import { SkipAiMusicMenuItem } from './templates/menu-item';

import type { BlockedSong, SkipAiMusicPluginConfig } from './types';
import type { RendererContext } from '@/types/contexts';

const ARTIST_ITEM_ID = 'skip-ai-music-block-artist';
const SONG_ITEM_ID = 'skip-ai-music-block-song';

const PERSON_ICON =
  'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z';
const SONG_ICON =
  'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z';

const currentTrack = () => {
  const info = getSongInfo();
  const title =
    info.title ||
    document.querySelector('ytmusic-player-bar .title')?.textContent?.trim() ||
    '';
  const artist =
    info.artist ||
    document.querySelector('ytmusic-player-bar .byline')?.textContent?.trim() ||
    '';

  return { artist, title };
};

const addUniqueSong = (songs: BlockedSong[], song: BlockedSong) => {
  const exists = songs.some(
    (item) =>
      item.title.toLowerCase() == song.title.toLowerCase() &&
      item.artist.toLowerCase() == song.artist.toLowerCase(),
  );
  if (exists) {
    return songs;
  }
  return [...songs, song];
};

const closeOpenMenu = () => {
  document
    .querySelector<HTMLElement>('tp-yt-iron-overlay-backdrop')
    ?.click();
};

const createMenuContainer = (id: string) => {
  const container = document.createElement('div');
  container.id = id;
  container.classList.add(
    'style-scope',
    'menu-item',
    'ytmusic-menu-popup-renderer',
  );
  container.setAttribute('aria-disabled', 'false');
  container.setAttribute('aria-selected', 'false');
  container.setAttribute('role', 'option');
  container.setAttribute('tabindex', '-1');
  return container;
};

export const renderer = {
  context: null as RendererContext<SkipAiMusicPluginConfig> | null,
  artistItem: null as HTMLElement | null,
  songItem: null as HTMLElement | null,
  menuObserver: null as MutationObserver | null,

  async start(ctx: RendererContext<SkipAiMusicPluginConfig>) {
    this.context = ctx;

    this.artistItem = createMenuContainer(ARTIST_ITEM_ID);
    render(
      () => (
        <SkipAiMusicMenuItem
          id={ARTIST_ITEM_ID}
          label={t('plugins.skip-ai-music.renderer.block-artist')}
          pathD={PERSON_ICON}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            this.blockArtist();
            closeOpenMenu();
          }}
        />
      ),
      this.artistItem,
    );

    this.songItem = createMenuContainer(SONG_ITEM_ID);
    render(
      () => (
        <SkipAiMusicMenuItem
          id={SONG_ITEM_ID}
          label={t('plugins.skip-ai-music.renderer.block-song')}
          pathD={SONG_ICON}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            this.blockSong();
            closeOpenMenu();
          }}
        />
      ),
      this.songItem,
    );

    const popup = await waitForElement<HTMLElement>('ytmusic-popup-container');
    this.menuObserver = new MutationObserver(() => {
      this.injectMenuItems();
    });
    this.menuObserver.observe(popup, {
      childList: true,
      subtree: true,
    });
  },

  injectMenuItems() {
    const menu = getSongMenu();
    if (
      !menu ||
      !this.artistItem ||
      !this.songItem ||
      !isMusicOrVideoTrack() ||
      !isPlayerMenu(menu)
    ) {
      return;
    }

    if (!menu.contains(this.artistItem)) {
      menu.append(this.artistItem);
    }
    if (!menu.contains(this.songItem)) {
      menu.append(this.songItem);
    }
  },

  async blockArtist() {
    if (!this.context) {
      return;
    }

    const { artist } = currentTrack();
    if (!artist) {
      return;
    }

    const config = await this.context.getConfig();
    await this.context.setConfig({
      blockedArtists: uniqueNormalized([...config.blockedArtists, artist]),
    });
  },

  async blockSong() {
    if (!this.context) {
      return;
    }

    const song = currentTrack();
    if (!song.title) {
      return;
    }

    const config = await this.context.getConfig();
    await this.context.setConfig({
      blockedSongs: addUniqueSong(config.blockedSongs, song),
    });
  },

  stop() {
    this.menuObserver?.disconnect();
    this.menuObserver = null;
    this.artistItem?.remove();
    this.songItem?.remove();
    this.artistItem = null;
    this.songItem = null;
    this.context = null;
  },
};
