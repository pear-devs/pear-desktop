import { FastAverageColor } from 'fast-average-color';
import Color, { type ColorInstance } from 'color';

import style from './style.css?inline';

import { createPlugin } from '@/utils';
import { t } from '@/i18n';

const COLOR_KEY = '--ytmusic-album-color';
const DARK_COLOR_KEY = '--ytmusic-album-color-dark';
const RATIO_KEY = '--ytmusic-album-color-ratio';

export default createPlugin<
  unknown,
  unknown,
  {
    color?: ColorInstance;
    darkColor?: ColorInstance;

    playerPage: HTMLElement | null;
    navBarBackground: HTMLElement | null;
    ytmusicPlayerBar: HTMLElement | null;
    playerBarBackground: HTMLElement | null;
    sidebarBig: HTMLElement | null;
    sidebarSmall: HTMLElement | null;
    ytmusicAppLayout: HTMLElement | null;

    getMixedColor(
      color: string,
      key: string,
      alpha?: number,
      ratioMultiply?: number,
    ): string;
    updateColor(alpha: number): void;
  },
  {
    enabled: boolean;
    ratio: number;
  }
>({
  name: () => t('plugins.album-color-theme.name'),
  description: () => t('plugins.album-color-theme.description'),
  restartNeeded: false,
  config: {
    enabled: false,
    ratio: 0.5,
  },
  stylesheets: [style],
  menu: async ({ getConfig, setConfig }) => {
    const ratioList = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];

    const config = await getConfig();

    return [
      {
        label: t('plugins.album-color-theme.menu.color-mix-ratio.label'),
        submenu: ratioList.map((ratio) => ({
          label: t(
            'plugins.album-color-theme.menu.color-mix-ratio.submenu.percent',
            {
              ratio: ratio * 100,
            },
          ),
          type: 'radio',
          checked: config.ratio === ratio,
          click() {
            setConfig({ ratio });
          },
        })),
      },
    ];
  },
  renderer: {
    playerPage: null,
    navBarBackground: null,
    ytmusicPlayerBar: null,
    playerBarBackground: null,
    sidebarBig: null,
    sidebarSmall: null,
    ytmusicAppLayout: null,

    async start({ getConfig }) {
      this.playerPage = document.querySelector<HTMLElement>('#player-page');
      this.navBarBackground = document.querySelector<HTMLElement>(
        '#nav-bar-background',
      );
      this.ytmusicPlayerBar =
        document.querySelector<HTMLElement>('ytmusic-player-bar');
      this.playerBarBackground = document.querySelector<HTMLElement>(
        '#player-bar-background',
      );
      this.sidebarBig = document.querySelector<HTMLElement>('#guide-wrapper');
      this.sidebarSmall = document.querySelector<HTMLElement>(
        '#mini-guide-background',
      );
      this.ytmusicAppLayout = document.querySelector<HTMLElement>('#layout');

      const config = await getConfig();
      document.documentElement.style.setProperty(
        RATIO_KEY,
        `${~~(config.ratio * 100)}%`,
      );
    },
    onPlayerApiReady(playerApi) {
      const fastAverageColor = new FastAverageColor();

      document.addEventListener('videodatachange', async (event) => {
        if (event.detail.name !== 'dataloaded') return;

        const playerResponse = playerApi.getPlayerResponse();
        const thumbnail =
          playerResponse?.videoDetails?.thumbnail?.thumbnails?.at(0);
        if (!thumbnail) return;

        const albumColor = await fastAverageColor
          .getColorAsync(thumbnail.url)
          .catch((err) => {
            console.error(err);
            return null;
          });

        if (albumColor) {
          const target = Color(albumColor.hex);

          this.darkColor = target.darken(0.3).rgb();
          this.color = target.darken(0.15).rgb();

          while (this.color.luminosity() > 0.5) {
            this.color = this.color?.darken(0.05);
            this.darkColor = this.darkColor?.darken(0.05);
          }

          document.documentElement.style.setProperty(
            COLOR_KEY,
            `${~~this.color.red()}, ${~~this.color.green()}, ${~~this.color.blue()}`,
          );
          document.documentElement.style.setProperty(
            DARK_COLOR_KEY,
            `${~~this.darkColor.red()}, ${~~this.darkColor.green()}, ${~~this.darkColor.blue()}`,
          );
        } else {
          document.documentElement.style.setProperty(COLOR_KEY, '0, 0, 0');
          document.documentElement.style.setProperty(DARK_COLOR_KEY, '0, 0, 0');
        }

        let alpha: number | null = null;
        if (await window.mainConfig.plugins.isEnabled('transparent-player')) {
          const value: unknown = window.mainConfig.get(
            'plugins.transparent-player.opacity',
          );
          if (typeof value === 'number' && value >= 0 && value <= 1) {
            alpha = value;
          }
        }
        this.updateColor(alpha ?? 1);
      });
    },
    onConfigChange(config) {
      document.documentElement.style.setProperty(
        RATIO_KEY,
        `${~~(config.ratio * 100)}%`,
      );
    },
    getMixedColor(color: string, key: string, alpha = 1, ratioMultiply) {
      const keyColor = `rgba(var(${key}), ${alpha})`;

      let colorRatio = `var(${RATIO_KEY}, 50%)`;
      let originalRatio = `calc(100% - var(${RATIO_KEY}, 50%))`;
      if (ratioMultiply) {
        colorRatio = `calc(var(${RATIO_KEY}, 50%) * ${ratioMultiply})`;
        originalRatio = `calc(100% - calc(var(${RATIO_KEY}, 50%) * ${ratioMultiply}))`;
      }
      return `color-mix(in srgb, ${color} ${originalRatio}, ${keyColor} ${colorRatio})`;
    },
    updateColor(alpha: number) {
      const variableMap = {
        '--ytmusic-color-black1': '#212121',
        '--ytmusic-color-black2': '#181818',
        '--ytmusic-color-black3': '#030303',
        '--ytmusic-color-black4': '#030303',
        '--ytmusic-color-blackpure': '#000',
        '--dark-theme-background-color': '#212121',
        '--yt-spec-base-background': '#0f0f0f',
        '--yt-spec-raised-background': '#212121',
        '--yt-spec-menu-background': '#282828',
        '--yt-spec-static-brand-black': '#212121',
        '--yt-spec-static-overlay-background-solid': '#000',
        '--yt-spec-static-overlay-background-heavy': 'rgba(0,0,0,0.8)',
        '--yt-spec-static-overlay-background-medium': 'rgba(0,0,0,0.6)',
        '--yt-spec-static-overlay-background-medium-light': 'rgba(0,0,0,0.3)',
        '--yt-spec-static-overlay-background-light': 'rgba(0,0,0,0.1)',
        '--yt-spec-general-background-a': '#181818',
        '--yt-spec-general-background-b': '#0f0f0f',
        '--yt-spec-general-background-c': '#030303',
        '--yt-spec-snackbar-background': '#030303',
        '--yt-spec-filled-button-text': '#030303',
        '--yt-spec-black-1': '#282828',
        '--yt-spec-black-2': '#1f1f1f',
        '--yt-spec-black-3': '#161616',
        '--yt-spec-black-4': '#0d0d0d',
        '--yt-spec-black-pure': '#000',
        '--yt-spec-black-pure-alpha-5': 'rgba(0,0,0,0.05)',
        '--yt-spec-black-pure-alpha-10': 'rgba(0,0,0,0.1)',
        '--yt-spec-black-pure-alpha-15': 'rgba(0,0,0,0.15)',
        '--yt-spec-black-pure-alpha-30': 'rgba(0,0,0,0.3)',
        '--yt-spec-black-pure-alpha-60': 'rgba(0,0,0,0.6)',
        '--yt-spec-black-pure-alpha-80': 'rgba(0,0,0,0.8)',
        '--yt-spec-black-1-alpha-98': 'rgba(40,40,40,0.98)',
        '--yt-spec-black-1-alpha-95': 'rgba(40,40,40,0.95)',
      };
      Object.entries(variableMap).map(([variable, color]) => {
        document.documentElement.style.setProperty(
          variable,
          this.getMixedColor(color, COLOR_KEY, alpha),
          'important',
        );
      });

      document.body.style.setProperty(
        'background',
        this.getMixedColor('rgba(3, 3, 3)', DARK_COLOR_KEY, alpha),
        'important',
      );
      document.documentElement.style.setProperty(
        '--ytmusic-background',
        // #030303
        this.getMixedColor('rgba(3, 3, 3)', DARK_COLOR_KEY, alpha),
        'important',
      );
    },
  },
});
