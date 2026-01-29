import is from 'electron-is';

import { MaterialType } from './types';

import type { BrowserWindow } from 'electron';
import type { BackendContext } from '@/types/contexts';
import type { TransparentPlayerConfig } from './types';

let mainWindow: BrowserWindow | null = null;

const setWindowMaterial = (window: BrowserWindow, type: MaterialType) => {
  if (type === MaterialType.NONE) {
    if (is.windows()) window.setBackgroundMaterial?.('none');
    else if (is.macOS()) window.setVibrancy?.(null);
    return;
  }

  if (is.windows()) {
    window.setBackgroundMaterial?.(
      type as Parameters<BrowserWindow['setBackgroundMaterial']>[0],
    );
  } else if (is.macOS()) {
    window.setVibrancy?.(type as Parameters<BrowserWindow['setVibrancy']>[0]);
  }
};

export const onMainLoad = async ({
  window,
  getConfig,
}: BackendContext<TransparentPlayerConfig>) => {
  mainWindow = window;
  const config = await getConfig();

  setWindowMaterial(window, config.type);
  window.setBackgroundColor?.(`rgba(0, 0, 0, ${config.opacity})`);
};

export const onConfigChange = (newConfig: TransparentPlayerConfig) => {
  if (mainWindow) {
    setWindowMaterial(mainWindow, newConfig.type);
    mainWindow.setBackgroundColor?.(`rgba(0, 0, 0, ${newConfig.opacity})`);
  }
};

export const onMainStop = ({
  window,
}: BackendContext<TransparentPlayerConfig>) => {
  setWindowMaterial(window, MaterialType.NONE);
};
