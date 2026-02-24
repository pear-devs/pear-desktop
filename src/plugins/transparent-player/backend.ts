import is from 'electron-is';

import { MaterialType, WINDOWS_MATERIALS, MACOS_MATERIALS } from './types';

import type { BrowserWindow } from 'electron';
import type { BackendContext } from '@/types/contexts';
import type { TransparentPlayerConfig } from './types';

let mainWindow: BrowserWindow | null = null;

const setWindowTransparency = (material: MaterialType, opacity: number) => {
  if (mainWindow === null) return;

  // Background materials are only supported on macOS and Windows
  if (is.windows()) {
    if (WINDOWS_MATERIALS.includes(material)) {
      mainWindow.setBackgroundMaterial(
        material as Parameters<BrowserWindow['setBackgroundMaterial']>[0],
      );
    } else {
      mainWindow.setBackgroundMaterial('none');
    }
  } else if (is.macOS()) {
    if (MACOS_MATERIALS.includes(material)) {
      mainWindow.setVibrancy(
        material as Parameters<BrowserWindow['setVibrancy']>[0],
      );
    } else {
      mainWindow.setVibrancy(null);
    }
  }

  // Set the opacity
  mainWindow.setBackgroundColor(`rgba(0, 0, 0, ${opacity})`);
};

export const onMainLoad = async ({
  window,
  getConfig,
}: BackendContext<TransparentPlayerConfig>) => {
  mainWindow = window;

  const config = await getConfig();
  setWindowTransparency(config.type, config.opacity);
};

export const onConfigChange = (newConfig: TransparentPlayerConfig) => {
  setWindowTransparency(newConfig.type, newConfig.opacity);
};

export const onMainStop = () => {
  setWindowTransparency(MaterialType.NONE, 1);
  mainWindow = null;
};
