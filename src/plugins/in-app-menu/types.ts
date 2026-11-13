import { config } from '@/plugins/utils/common/config';
import { Platform } from '@/types/plugins';

import type { Menu, MenuItem } from 'electron';

export const inAppMenuConfig = {
  hideDOMWindowControls: config.bool(false, {
    label: 'plugins.in-app-menu.menu.hide-dom-window-controls',
    platforms: Platform.Linux,
  }),
};

/** On by default everywhere but macOS and Linux. */
export const isEnabledByDefault = () =>
  ((typeof window !== 'undefined' &&
    !window.navigator?.userAgent?.toLowerCase().includes('mac')) ||
    (typeof global !== 'undefined' && global.process?.platform !== 'darwin')) &&
  ((typeof window !== 'undefined' &&
    !window.navigator?.userAgent?.toLowerCase().includes('linux')) ||
    (typeof global !== 'undefined' && global.process?.platform !== 'linux'));

export type InAppMenuIpc = {
  invoke: {
    getMenu(): Menu | null;
    getMenuById(commandId: number): MenuItem | null;
    /** Clicks the application menu item. */
    menuEvent(commandId: number): void;
    windowIsMaximized(): boolean;
    windowClose(): void;
    windowMinimize(): void;
    windowMaximize(): void;
    windowUnmaximize(): void;
  };
  toRenderer: {
    closeAllPanels: [];
    toggleMenu: [];
    maximized: [];
    unmaximized: [];
  };
};
