export interface WindowSizeConfig {
  width: number;
  height: number;
}

export interface WindowPositionConfig {
  x: number;
  y: number;
}

export interface DefaultConfig {
  'window-size': WindowSizeConfig;
  'window-maximized': boolean;
  'window-position': WindowPositionConfig;
  'url': string;
  'options': {
    language?: string;
    tray: boolean;
    appVisible: boolean;
    autoUpdates: boolean;
    alwaysOnTop: boolean;
    hideMenu: boolean;
    hideMenuWarned: boolean;
    startAtLogin: boolean;
    disableHardwareAcceleration: boolean;
    removeUpgradeButton: boolean;
    restartOnConfigChanges: boolean;
    trayClickPlayPause: boolean;
    autoResetAppCache: boolean;
    resumeOnStart: boolean;
    likeButtons: string;
    proxy: string;
    startingPage: string;
    backgroundMaterial?: 'none' | 'mica' | 'acrylic' | 'tabbed';
    overrideUserAgent: boolean;
    usePodcastParticipantAsArtist: boolean;
    themes: string[];
    customWindowTitle?: string;
  };
  'plugins': Record<string, unknown>;
}

export const defaultConfig: DefaultConfig = {
  'window-size': {
    width: 1100,
    height: 550,
  },
  'window-maximized': false,
  'window-position': {
    x: -1,
    y: -1,
  },
  'url': 'https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com',
  'options': {
    tray: false,
    appVisible: true,
    autoUpdates: true,
    alwaysOnTop: false,
    hideMenu: false,
    hideMenuWarned: false,
    startAtLogin: false,
    disableHardwareAcceleration: false,
    removeUpgradeButton: false,
    restartOnConfigChanges: false,
    trayClickPlayPause: false,
    autoResetAppCache: false,
    resumeOnStart: true,
    likeButtons: '',
    proxy: '',
    startingPage: '',
    overrideUserAgent: false,
    usePodcastParticipantAsArtist: false,
    themes: [],
  },
  'plugins': {},
};
