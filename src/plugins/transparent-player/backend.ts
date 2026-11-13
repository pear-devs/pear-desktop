import is from 'electron-is';

import { createBackend } from '@/utils';

import {
  MaterialType,
  WINDOWS_MATERIALS,
  MACOS_MATERIALS,
  type transparentPlayerConfig,
} from './types';

import type { BrowserWindow } from 'electron';

const setWindowTransparency = (
  window: BrowserWindow,
  material: MaterialType,
  opacity: number,
) => {
  // Background materials are only supported on macOS and Windows
  if (is.windows()) {
    if (WINDOWS_MATERIALS.includes(material)) {
      window.setBackgroundMaterial(
        material as Parameters<BrowserWindow['setBackgroundMaterial']>[0],
      );
    } else {
      window.setBackgroundMaterial('none');
    }
  } else if (is.macOS()) {
    if (MACOS_MATERIALS.includes(material)) {
      window.setVibrancy(
        material as Parameters<BrowserWindow['setVibrancy']>[0],
      );
    } else {
      window.setVibrancy(null);
    }
  }

  // Set the opacity
  window.setBackgroundColor(`rgba(0, 0, 0, ${opacity})`);
};

export const backend = createBackend<typeof transparentPlayerConfig>((ctx) => {
  const apply = () =>
    setWindowTransparency(ctx.window, ctx.config.type, ctx.config.opacity);

  apply();
  ctx.onConfigChange(apply);
  ctx.onCleanup(() => {
    if (!ctx.window.isDestroyed()) {
      setWindowTransparency(ctx.window, MaterialType.NONE, 1);
    }
  });
});
