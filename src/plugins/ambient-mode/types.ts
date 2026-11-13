import { config } from '@/plugins/utils/common/config';

const interpolationTimeList = [0, 500, 1000, 1500, 2000, 3000, 4000, 5000];
const qualityList = [10, 25, 50, 100, 200, 500, 1000];
const sizeList = [100, 110, 125, 150, 175, 200, 300];
const bufferList = [1, 5, 10, 20, 30];
const blurAmountList = [0, 5, 10, 25, 50, 100, 150, 200, 500];
const opacityList = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];

// Keys in the order of the menu.
export const ambientModeConfig = {
  interpolationTime: config.number(1500, {
    label: 'plugins.ambient-mode.menu.smoothness-transition.label',
    options: interpolationTimeList.map((interpolationTime) => ({
      value: interpolationTime,
      label: {
        key: 'plugins.ambient-mode.menu.smoothness-transition.submenu.during',
        vars: { interpolationTime: interpolationTime / 1000 },
      },
    })),
  }),
  quality: config.number(50, {
    label: 'plugins.ambient-mode.menu.quality.label',
    options: qualityList.map((quality) => ({
      value: quality,
      label: {
        key: 'plugins.ambient-mode.menu.quality.submenu.pixels',
        vars: { quality },
      },
    })),
  }),
  size: config.number(100, {
    label: 'plugins.ambient-mode.menu.size.label',
    options: sizeList.map((size) => ({
      value: size,
      label: {
        key: 'plugins.ambient-mode.menu.size.submenu.percent',
        vars: { size },
      },
    })),
  }),
  buffer: config.number(30, {
    label: 'plugins.ambient-mode.menu.buffer.label',
    options: bufferList.map((buffer) => ({
      value: buffer,
      label: {
        key: 'plugins.ambient-mode.menu.buffer.submenu.buffer',
        vars: { buffer },
      },
    })),
  }),
  opacity: config.number(1, {
    label: 'plugins.ambient-mode.menu.opacity.label',
    options: opacityList.map((opacity) => ({
      value: opacity,
      label: {
        key: 'plugins.ambient-mode.menu.opacity.submenu.percent',
        vars: { opacity: opacity * 100 },
      },
    })),
  }),
  blur: config.number(100, {
    label: 'plugins.ambient-mode.menu.blur-amount.label',
    options: blurAmountList.map((blur) => ({
      value: blur,
      label: {
        key: 'plugins.ambient-mode.menu.blur-amount.submenu.pixels',
        vars: { blurAmount: blur },
      },
    })),
  }),
  fullscreen: config.bool(false, {
    label: 'plugins.ambient-mode.menu.use-fullscreen.label',
  }),
};
