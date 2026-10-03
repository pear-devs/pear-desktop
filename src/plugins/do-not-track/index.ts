import { contextBridge, webFrame, type BrowserWindow } from 'electron';

import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import {
  getLocalBlockListNames,
  isBlockerEnabled,
  loadTrackerBlockerEngine,
  unloadTrackerBlockerEngine,
} from './blocker';
import { inject, isInjected } from './injectors/inject';
import injectCliqzPreload from './injectors/inject-cliqz-preload';
import balancedRules from './lists/balanced.txt?raw';
import strictRules from './lists/strict-addon.txt?raw';
import { blockers, isLegacyCustomBlocker, normalizeBlocker } from './types';

const usesBlockLists = (blocker: unknown, customEnabled: unknown) =>
  normalizeBlocker(blocker) !== blockers.Lite || customEnabled === true;

const getPresetBlockLists = (blocker: unknown): string[] => {
  const normalizedBlocker = normalizeBlocker(blocker);
  const includeBalanced =
    normalizedBlocker === blockers.Balanced ||
    normalizedBlocker === blockers.Strict;

  return [
    ...(includeBalanced ? [balancedRules] : []),
    ...(normalizedBlocker === blockers.Strict ? [strictRules] : []),
  ];
};

export interface TrackerBlockerConfig {
  /**
   * Whether to enable the tracker blocker.
   * @default true
   */
  enabled: boolean;
  /**
   * When enabled, the tracker blocker will cache the blocklists.
   * @default true
   */
  cache: boolean;
  /**
   * Which tracker blocker to use.
   * @default blockers.Lite
   */
  blocker: (typeof blockers)[keyof typeof blockers];
  /**
   * Additional list of filters to use.
   * @example ["https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt"]
   * @default []
   */
  additionalBlockLists: string[];
  /**
   * Individual Adblock Plus/uBlock filter rules.
   * @default []
   */
  additionalBlockListRules: string[];
  /**
   * Local blocklist file names disabled in Custom mode. Files not listed here
   * are enabled by default.
   * @default []
   */
  disabledLocalBlockLists: string[];
  /**
   * Apply local, inline, remote, and selected built-in Custom profiles in
   * addition to the active base profile.
   * @default false
   */
  customEnabled: boolean;
  /**
   * Disable the default blocklists.
   * @default false
   */
  disableDefaultLists: boolean;
}

export default createPlugin({
  name: () => t('plugins.do-not-track.name'),
  description: () => t('plugins.do-not-track.description'),
  restartNeeded: false,
  config: {
    enabled: false,
    cache: true,
    blocker: blockers.Lite,
    additionalBlockLists: [],
    additionalBlockListRules: [],
    customEnabled: false,
    disabledLocalBlockLists: [],
    disableDefaultLists: false,
  } as TrackerBlockerConfig,
  menu: async ({ getConfig, setConfig }) => {
    const config = await getConfig();
    const localBlockLists = await getLocalBlockListNames();

    return [
      ...Object.values(blockers).map((blocker) => ({
        label: blocker,
        type: 'radio' as const,
        checked: normalizeBlocker(config.blocker) === blocker,
        click() {
          setConfig({ blocker });
        },
      })),
      { type: 'separator' },
      {
        label: 'Custom',
        submenu: [
          {
            label: 'Enabled',
            type: 'checkbox',
            checked: config.customEnabled === true,
            click() {
              setConfig({ customEnabled: config.customEnabled !== true });
            },
          },
          ...localBlockLists.map((file) => ({
            label: file,
            type: 'checkbox' as const,
            enabled: config.customEnabled === true,
            checked: !config.disabledLocalBlockLists.includes(file),
            click() {
              const disabled = new Set(config.disabledLocalBlockLists);
              if (disabled.has(file)) {
                disabled.delete(file);
              } else {
                disabled.add(file);
              }
              setConfig({ disabledLocalBlockLists: [...disabled] });
            },
          })),
        ],
      },
    ];
  },
  backend: {
    mainWindow: null as BrowserWindow | null,
    reloadPromise: Promise.resolve(),
    async start({ getConfig, setConfig, window }) {
      const config = await getConfig();
      const blocker = normalizeBlocker(config.blocker);
      const customEnabled =
        config.customEnabled === true || isLegacyCustomBlocker(config.blocker);
      if (
        config.blocker !== blocker ||
        config.customEnabled !== customEnabled
      ) {
        await setConfig({ blocker, customEnabled });
        config.blocker = blocker;
        config.customEnabled = customEnabled;
      }
      this.mainWindow = window;

      if (usesBlockLists(config.blocker, config.customEnabled)) {
        await loadTrackerBlockerEngine(
          window.webContents.session,
          config.cache,
          config.customEnabled ? config.additionalBlockLists : [],
          getPresetBlockLists(config.blocker),
          config.customEnabled ? config.additionalBlockListRules : [],
          config.customEnabled ? config.disableDefaultLists : true,
          config.customEnabled,
          config.disabledLocalBlockLists,
        );
      }
    },
    stop({ window }) {
      if (isBlockerEnabled(window.webContents.session)) {
        unloadTrackerBlockerEngine(window.webContents.session);
      }
    },
    async onConfigChange(newConfig) {
      this.reloadPromise = this.reloadPromise
        .catch(() => undefined)
        .then(async () => {
          if (!this.mainWindow) return;

          const session = this.mainWindow.webContents.session;
          const wasBlockerEnabled = isBlockerEnabled(session);
          if (wasBlockerEnabled) {
            unloadTrackerBlockerEngine(session);
          }
          if (usesBlockLists(newConfig.blocker, newConfig.customEnabled)) {
            await loadTrackerBlockerEngine(
              session,
              newConfig.cache,
              newConfig.customEnabled ? newConfig.additionalBlockLists : [],
              getPresetBlockLists(newConfig.blocker),
              newConfig.customEnabled ? newConfig.additionalBlockListRules : [],
              newConfig.customEnabled ? newConfig.disableDefaultLists : true,
              newConfig.customEnabled,
              newConfig.disabledLocalBlockLists,
            );
          } else if (wasBlockerEnabled) {
            // unregisterPreloadScript only affects later navigations. Reload so
            // Ghostery code in this page cannot invoke removed IPC handlers.
            this.mainWindow.webContents.reload();
          }
        });
      await this.reloadPromise;
    },
  },
  preload: {
    // see #1478
    script: `const _prunerFn = window._pruner;
    window._pruner = undefined;
    JSON.parse = new Proxy(JSON.parse, {
      apply() {
        return _prunerFn(Reflect.apply(...arguments));
      },
    });
    Response.prototype.json = new Proxy(Response.prototype.json, {
      apply() {
        return Reflect.apply(...arguments).then((o) => _prunerFn(o));
      },
    }); 0`,
    async start({ getConfig }) {
      const config = await getConfig();

      if (!isInjected()) {
        // Safe built-in equivalent for YouTube ad-response scriptlets.
        // Filter lists remain declarative: arbitrary ##+js rules never run.
        inject(contextBridge);
        await webFrame.executeJavaScript(this.script);
      }

      if (usesBlockLists(config.blocker, config.customEnabled)) {
        await injectCliqzPreload();
      }
    },
    async onConfigChange(newConfig) {
      if (!isInjected()) {
        inject(contextBridge);
        await webFrame.executeJavaScript(this.script);
      }
      if (usesBlockLists(newConfig.blocker, newConfig.customEnabled)) {
        await injectCliqzPreload();
      }
    },
  },
});
