import { t } from '@/i18n';
import { getSongInfo } from '@/providers/song-info-front';
import { waitForElement } from '@/utils/wait-for-element';

import { uniqueNormalized } from './match';

import type { BlockedSong, SkipAiMusicPluginConfig } from './types';
import type { RendererContext } from '@/types/contexts';

const CONTROLS_ID = 'skip-ai-music-controls';

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

const createButton = (label: string, onClick: () => void) => {
  const button = document.createElement('button');
  button.className = 'skip-ai-music-button';
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return button;
};

export const renderer = {
  context: null as RendererContext<SkipAiMusicPluginConfig> | null,
  buttonsMounted: false,

  async start(ctx: RendererContext<SkipAiMusicPluginConfig>) {
    this.context = ctx;
    const config = await ctx.getConfig();
    if (config.showPlayerButtons) {
      await this.mountButtons();
    }
  },

  async mountButtons() {
    if (this.buttonsMounted) {
      return;
    }

    const playerBar = await waitForElement<HTMLElement>('ytmusic-player-bar');
    if (document.getElementById(CONTROLS_ID)) {
      this.buttonsMounted = true;
      return;
    }

    const threeDots =
      playerBar.querySelector(
        '.middle-controls-buttons ytmusic-menu-renderer',
      ) || playerBar.querySelector('ytmusic-menu-renderer');
    const parent =
      threeDots?.parentElement ||
      playerBar.querySelector('.middle-controls-buttons');
    if (!parent) {
      return;
    }

    const container = document.createElement('div');
    container.id = CONTROLS_ID;
    container.className = 'skip-ai-music-controls';

    container.append(
      createButton(t('plugins.skip-ai-music.renderer.block-artist'), () => {
        this.blockArtist();
      }),
      createButton(t('plugins.skip-ai-music.renderer.block-song'), () => {
        this.blockSong();
      }),
    );

    if (threeDots?.nextSibling) {
      parent.insertBefore(container, threeDots.nextSibling);
    } else {
      parent.append(container);
    }

    this.buttonsMounted = true;
  },

  unmountButtons() {
    document.getElementById(CONTROLS_ID)?.remove();
    this.buttonsMounted = false;
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

  async onConfigChange(newConfig: SkipAiMusicPluginConfig) {
    if (newConfig.showPlayerButtons) {
      await this.mountButtons();
    } else {
      this.unmountButtons();
    }
  },

  stop() {
    this.unmountButtons();
    this.context = null;
  },
};
