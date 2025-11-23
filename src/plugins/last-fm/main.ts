import { BrowserWindow, net } from 'electron';
import crypto from 'node:crypto';

import { createBackend } from '@/utils';
import {
    registerCallback,
    SongInfo,
    SongInfoEvent,
} from '@/providers/song-info';

import type { LastFmConfig } from './index';

/**
 * Interface representing the data sent to Last.fm API.
 * Keys are dynamic because Last.fm API parameters vary by method.
 */
interface LastFmApiParams extends Record<string, string | number | undefined> {
    method: string;
    api_key: string;
    sk?: string;
    format: 'json';
    api_sig?: string;
}

/**
 * Generates the API signature required by Last.fm.
 * The signature is an MD5 hash of all parameters (sorted alphabetically) + the API secret.
 *
 * @param params - The parameters to sign.
 * @param secret - The Last.fm API secret.
 * @returns The MD5 hash signature.
 */
const createApiSig = (params: Record<string, unknown>, secret: string) => {
    let sig = '';
    Object.entries(params)
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([key, value]) => {
            // 'format' and 'callback' are not included in the signature
            if (key === 'format' || key === 'callback') return;
            sig += key + String(value);
        });
    sig += secret;
    return crypto.createHash('md5').update(sig, 'utf-8').digest('hex');
};

/**
 * Creates a query string from parameters, including the generated signature.
 *
 * @param params - The parameters to include in the query string.
 * @param apiSignature - The generated API signature.
 * @returns The formatted query string (e.g., "?key=value&api_sig=...").
 */
const createQueryString = (
    params: Record<string, unknown>,
    apiSignature: string,
) => {
    const queryParams = { ...params, api_sig: apiSignature };
    const queryData = Object.entries(queryParams).map(
        ([key, value]) =>
            `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
    );
    return '?' + queryData.join('&');
};

/**
 * Creates a FormData object for POST requests.
 *
 * @param params - The parameters to append to the form data.
 * @returns The populated URLSearchParams object.
 */
const createFormData = (params: Record<string, unknown>) => {
    const formData = new URLSearchParams();
    for (const key in params) {
        if (params[key] !== undefined) {
            formData.append(key, String(params[key]));
        }
    }
    return formData;
};

export const backend = createBackend<{
    config?: LastFmConfig;
    window?: BrowserWindow;
    scrobbleTimer?: NodeJS.Timeout;

    startAuth(config: LastFmConfig): Promise<void>;
    createSession(config: LastFmConfig): Promise<void>;
    scrobble(songInfo: SongInfo, config: LastFmConfig): Promise<void>;
    updateNowPlaying(songInfo: SongInfo, config: LastFmConfig): Promise<void>;
}>({
    async start({ getConfig, setConfig, window }) {
        this.config = await getConfig();
        this.window = window;

        // If enabled but no session key, start the authentication flow
        if (this.config.enabled && !this.config.sessionKey) {
            await this.startAuth(this.config);
            await setConfig(this.config);
        }

        // Register a callback to listen for song changes
        registerCallback((songInfo: SongInfo, event) => {
            // Ignore time updates, we only care about track changes or pause/play
            if (event === SongInfoEvent.TimeChanged) return;

            // Clear any pending scrobble timer to prevent duplicate scrobbles
            clearTimeout(this.scrobbleTimer);

            if (
                !songInfo.isPaused &&
                this.config?.enabled &&
                this.config.sessionKey
            ) {
                // 1. Update "Now Playing" status on Last.fm
                this.updateNowPlaying(songInfo, this.config);

                // 2. Schedule the Scrobble
                // Rule: Scrobble at 33% of the song duration OR 4 minutes, whichever comes first.
                const scrobbleThreshold = Math.min(
                    Math.ceil(songInfo.songDuration * 0.33),
                    4 * 60, // 4 minutes in seconds
                );

                const elapsed = songInfo.elapsedSeconds ?? 0;

                if (scrobbleThreshold > elapsed) {
                    const timeToWait = (scrobbleThreshold - elapsed) * 1000;
                    this.scrobbleTimer = setTimeout(() => {
                        if (this.config) {
                            this.scrobble(songInfo, this.config);
                        }
                    }, timeToWait);
                }
            }
        });
    },

    async onConfigChange(newConfig) {
        this.config = newConfig;
        // Re-authenticate if the plugin is enabled but lacks a session key
        if (this.config.enabled && !this.config.sessionKey) {
            await this.startAuth(this.config);
        }
    },

    /**
     * Starts the Last.fm authentication process.
     * 1. Fetches a request token.
     * 2. Opens a browser window for the user to approve the application.
     * 3. Creates a session after approval.
     */
    async startAuth(config: LastFmConfig) {
        // Step 1: Get a Request Token
        const tokenParams = {
            method: 'auth.gettoken',
            api_key: config.apiKey,
            format: 'json',
        };
        const tokenSig = createApiSig(tokenParams, config.secret);
        const tokenRes = await net.fetch(
            `${config.apiRoot}${createQueryString(tokenParams, tokenSig)}`,
        );
        const tokenJson = (await tokenRes.json()) as { token?: string };

        if (!tokenJson.token) {
            console.error('Last.fm: Failed to get authentication token.');
            return;
        }
        config.token = tokenJson.token;

        // Step 2: Request User Approval via Browser Window
        const authUrl = `https://www.last.fm/api/auth/?api_key=${config.apiKey}&token=${config.token}`;

        const authWindow = new BrowserWindow({
            width: 500,
            height: 600,
            parent: this.window,
            modal: true,
            show: false,
            autoHideMenuBar: true,
        });

        authWindow.loadURL(authUrl);
        authWindow.show();

        // Wait for the user to approve the app in the opened window
        return new Promise<void>((resolve) => {
            authWindow.webContents.on('did-navigate', async (_, newUrl) => {
                const url = new URL(newUrl);
                // Last.fm redirects to this URL after approval
                if (url.hostname.endsWith('last.fm') && url.pathname === '/api/auth') {
                    // Check if the approval was successful by looking for the confirmation element
                    // This is a heuristic; ideally we'd use a callback URL but this is a desktop app
                    const isApproveScreen = await authWindow.webContents.executeJavaScript(
                        "!!document.getElementsByName('confirm').length",
                    );

                    // If we are past the confirmation screen (or it didn't show), assume success
                    if (!isApproveScreen) {
                        authWindow.close();
                        await this.createSession(config);
                        resolve();
                    }
                }
            });

            // Handle window close by user (cancellation)
            authWindow.on('closed', () => {
                resolve();
            });
        });
    },

    /**
     * Exchanges the request token for a session key.
     */
    async createSession(config: LastFmConfig) {
        if (!config.token) return;

        const params = {
            api_key: config.apiKey,
            format: 'json',
            method: 'auth.getsession',
            token: config.token,
        };
        const sig = createApiSig(params, config.secret);
        const res = await net.fetch(
            `${config.apiRoot}${createQueryString(params, sig)}`,
        );
        const json = (await res.json()) as { session?: { key: string } };

        if (json.session) {
            config.sessionKey = json.session.key;
            console.log('Last.fm: Session created successfully.');
        } else {
            console.error('Last.fm: Failed to create session.', json);
        }
    },

    /**
     * Updates the "Now Playing" track on Last.fm.
     */
    async updateNowPlaying(songInfo: SongInfo, config: LastFmConfig) {
        if (!config.sessionKey) return;

        const params: LastFmApiParams = {
            method: 'track.updateNowPlaying',
            track: songInfo.title,
            artist: songInfo.artist,
            duration: songInfo.songDuration,
            api_key: config.apiKey,
            sk: config.sessionKey,
            format: 'json',
        };

        if (songInfo.album) {
            params.album = songInfo.album;
        }

        const sig = createApiSig(params, config.secret);
        const formData = createFormData({ ...params, api_sig: sig });

        try {
            await net.fetch(config.apiRoot, {
                method: 'POST',
                body: formData,
            });
        } catch (error) {
            console.error('Last.fm: Failed to update Now Playing.', error);
        }
    },

    /**
     * Scrobbles a track to Last.fm.
     */
    async scrobble(songInfo: SongInfo, config: LastFmConfig) {
        if (!config.sessionKey) return;

        const params: LastFmApiParams = {
            method: 'track.scrobble',
            track: songInfo.title,
            artist: songInfo.artist,
            timestamp: Math.floor(Date.now() / 1000),
            api_key: config.apiKey,
            sk: config.sessionKey,
            format: 'json',
        };

        if (songInfo.album) {
            params.album = songInfo.album;
        }

        const sig = createApiSig(params, config.secret);
        const formData = createFormData({ ...params, api_sig: sig });

        try {
            await net.fetch(config.apiRoot, {
                method: 'POST',
                body: formData,
            });
            console.log(`Last.fm: Scrobble successful for ${songInfo.artist} - ${songInfo.title}`);
        } catch (error) {
            console.error('Last.fm: Failed to scrobble.', error);
        }
    },
});
