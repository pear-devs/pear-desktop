import Color from 'color';
import { FastAverageColor } from 'fast-average-color';

import { t } from '@/i18n';
import { config } from '@/plugins/utils/common/config';
import { createPlugin } from '@/utils';

import style from './style.css?inline';

const COLOR_KEY = '--ytmusic-album-color';
const DARK_COLOR_KEY = '--ytmusic-album-color-dark';
const RATIO_KEY = '--ytmusic-album-color-ratio';

const ratioList = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];

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
  '--paper-toast-background-color': '#323232',
  '--ytmusic-search-background': '#030303',
  '--paper-slider-knob-color': '#f03',
  '--paper-dialog-background-color': '#212121',
  '--paper-progress-active-color-1': '#f03',
  '--paper-progress-active-color-2': '#ff2791',
  '--yt-spec-inverted-background': '#f3f3f3',
  'background': 'rgba(3, 3, 3)',
  '--ytmusic-background': 'rgba(3, 3, 3)',
};

const colorKeyMap: Record<string, string> = {
  'background': DARK_COLOR_KEY,
  '--ytmusic-background': DARK_COLOR_KEY,
};

const ratioMap: Record<string, number> = {
  '--paper-progress-active-color-1': 1.75,
  '--paper-progress-active-color-2': 1.75,
  '--yt-spec-inverted-background': 1.75,
};

const getMixedColor = (
  color: string,
  key: string,
  alpha = 1,
  ratioMultiply?: number,
) => {
  const keyColor = `rgba(var(${key}), ${alpha})`;

  let colorRatio = `var(${RATIO_KEY}, 50%)`;
  let originalRatio = `calc(100% - var(${RATIO_KEY}, 50%))`;
  if (ratioMultiply) {
    colorRatio = `calc(var(${RATIO_KEY}, 50%) * ${ratioMultiply})`;
    originalRatio = `calc(100% - calc(var(${RATIO_KEY}, 50%) * ${ratioMultiply}))`;
  }
  return `color-mix(in srgb, ${color} ${originalRatio}, ${keyColor} ${colorRatio})`;
};

const updateColor = (alpha: number) => {
  for (const [variable, color] of Object.entries(variableMap)) {
    const key = colorKeyMap[variable] ?? COLOR_KEY;
    const ratio = ratioMap[variable] ?? undefined;

    document.documentElement.style.setProperty(
      variable,
      getMixedColor(color, key, alpha, ratio),
      'important',
    );
  }
};

export default createPlugin({
  name: () => t('plugins.album-color-theme.name'),
  description: () => t('plugins.album-color-theme.description'),
  restartNeeded: false,
  config: {
    ratio: config.number(0.5, {
      label: 'plugins.album-color-theme.menu.color-mix-ratio.label',
      min: 0,
      max: 1,
      options: ratioList.map((ratio) => ({
        value: ratio,
        label: {
          key: 'plugins.album-color-theme.menu.color-mix-ratio.submenu.percent',
          vars: { ratio: ratio * 100 },
        },
      })),
    }),
    enableSeekbar: config.bool(true, {
      label: 'plugins.album-color-theme.menu.enable-seekbar',
    }),
  },
  stylesheets: [style],
  renderer: (ctx) => {
    const root = document.documentElement.style;

    const applyConfig = () => {
      root.setProperty(RATIO_KEY, `${~~(ctx.config.ratio * 100)}%`);
      document.body.classList.toggle('seekbar-theme', ctx.config.enableSeekbar);
    };

    ctx.onCleanup(() => {
      for (const key of [
        COLOR_KEY,
        DARK_COLOR_KEY,
        RATIO_KEY,
        ...Object.keys(variableMap),
      ]) {
        root.removeProperty(key);
      }
      document.body.classList.remove('seekbar-theme');
    });
    ctx.onConfigChange(applyConfig);

    ctx.onPlayerApiReady((playerApi) => {
      applyConfig();

      const fastAverageColor = new FastAverageColor();
      ctx.onCleanup(() => fastAverageColor.destroy());

      ctx.listen(document, 'videodatachange', async (event) => {
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
        if (ctx.signal.aborted) return;

        if (albumColor) {
          const target = Color(albumColor.hex);

          let darkColor = target.darken(0.3).rgb();
          let color = target.darken(0.15).rgb();

          while (color.luminosity() > 0.5) {
            color = color.darken(0.05);
            darkColor = darkColor.darken(0.05);
          }

          root.setProperty(
            COLOR_KEY,
            `${~~color.red()}, ${~~color.green()}, ${~~color.blue()}`,
          );
          root.setProperty(
            DARK_COLOR_KEY,
            `${~~darkColor.red()}, ${~~darkColor.green()}, ${~~darkColor.blue()}`,
          );
        } else {
          root.setProperty(COLOR_KEY, '0, 0, 0');
          root.setProperty(DARK_COLOR_KEY, '0, 0, 0');
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
        if (ctx.signal.aborted) return;
        updateColor(alpha ?? 1);
      });
    });
  },
});
