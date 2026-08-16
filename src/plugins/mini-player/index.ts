import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { onConfigChange, onMainLoad, onUnload } from './main';
import { onMenu } from './menu';

export type MiniPlayerPluginConfig = {
  enabled: boolean;
  /** Window opacity while the pointer is elsewhere (0.2 - 1). */
  opacity: number;
  /** Become fully opaque while the pointer is over the mini player. */
  opaqueOnHover: boolean;
  alwaysOnTop: boolean;
  /** Hide the main window while the mini player is open. */
  hideMainWindow: boolean;
  /** Open the mini player as soon as the app starts. */
  openOnStart: boolean;
  hotkey: string;
  position: [number, number] | null;
  size: [number, number];
};

export const defaultConfig: MiniPlayerPluginConfig = {
  enabled: false,
  opacity: 0.95,
  opaqueOnHover: true,
  alwaysOnTop: true,
  hideMainWindow: true,
  openOnStart: false,
  hotkey: 'CmdOrCtrl+Shift+M',
  position: null,
  size: [400, 100],
};

export default createPlugin({
  name: () => t('plugins.mini-player.name'),
  description: () => t('plugins.mini-player.description'),
  restartNeeded: false,
  config: defaultConfig,
  menu: onMenu,

  backend: {
    start: onMainLoad,
    stop: onUnload,
    onConfigChange,
  },
});
