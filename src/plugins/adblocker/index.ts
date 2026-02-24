import { contextBridge, webFrame } from 'electron';

import { blockers } from './types';
import { createPlugin } from '@/utils';
import {
    isBlockerEnabled,
    loadAdBlockerEngine,
    unloadAdBlockerEngine,
} from './blocker';

import injectCliqzPreload from './injectors/inject-cliqz-preload';
import { inject, isInjected } from './injectors/inject';

import { t } from '@/i18n';

import type { BrowserWindow } from 'electron';

interface AdblockerConfig {
    /**
     * Whether to enable the adblocker.
     * @default true
     */
    enabled: boolean;
    /**
     * When enabled, the adblocker will cache the blocklists.
     * @default true
     */
    cache: boolean;
    /**
     * Which adblocker to use.
     * @default blockers.InPlayer
     */
    blocker: (typeof blockers)[keyof typeof blockers];
    /**
     * Additional list of filters to use.
     * @example ["https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt"]
     * @default []
     */
    additionalBlockLists: string[];
    /**
     * Disable the default blocklists.
     * @default false
     */
    disableDefaultLists: boolean;
}

export default createPlugin({
    name: () => t('plugins.adblocker.name'),
    description: () => t('plugins.adblocker.description'),
    restartNeeded: false,
    config: {
        enabled: true,
        cache: true,
        blocker: blockers.InPlayer,
        additionalBlockLists: [],
        disableDefaultLists: false,
    } as AdblockerConfig,
    menu: async ({ getConfig, setConfig }) => {
        const config = await getConfig();

        return [
            {
                label: t('plugins.adblocker.menu.blocker'),
                submenu: Object.values(blockers).map((blocker) => ({
                    label: blocker,
                    type: 'radio',
                    checked: (config.blocker || blockers.WithBlocklists) === blocker,
                    click() {
                        setConfig({ blocker });
                    },
                })),
            },
        ];
    },
    backend: {
        mainWindow: null as BrowserWindow | null,
        async start({ getConfig, window }) {
            const config = await getConfig();
            this.mainWindow = window;

            if (config.blocker === blockers.WithBlocklists) {
                await loadAdBlockerEngine(
                    window.webContents.session,
                    config.cache,
                    config.additionalBlockLists,
                    config.disableDefaultLists,
                );
            }
        },
        stop({ window }) {
            if (isBlockerEnabled(window.webContents.session)) {
                unloadAdBlockerEngine(window.webContents.session);
            }
        },
        async onConfigChange(newConfig) {
            if (this.mainWindow) {
                if (
                    newConfig.blocker === blockers.WithBlocklists &&
                    !isBlockerEnabled(this.mainWindow.webContents.session)
                ) {
                    await loadAdBlockerEngine(
                        this.mainWindow.webContents.session,
                        newConfig.cache,
                        newConfig.additionalBlockLists,
                        newConfig.disableDefaultLists,
                    );
                }
            }
        },
    },
    preload: {
        script: 'window.JSON.parse = window._proxyJsonParse; window._proxyJsonParse = undefined; window.Response.prototype.json = window._proxyResponseJson; window._proxyResponseJson = undefined; 0',
        async start({ getConfig }) {
            const config = await getConfig();

            if (config.blocker === blockers.WithBlocklists) {
                // Preload adblocker to inject scripts/styles
                await injectCliqzPreload();
            } else if (config.blocker === blockers.InPlayer && !isInjected()) {
                inject(contextBridge);
                await webFrame.executeJavaScript(this.script);
            }
        },
        async onConfigChange(newConfig) {
            if (newConfig.blocker === blockers.WithBlocklists) {
                await injectCliqzPreload();
            } else if (newConfig.blocker === blockers.InPlayer && !isInjected()) {
                inject(contextBridge);
                await webFrame.executeJavaScript(this.script);
            }
        },
    },
});