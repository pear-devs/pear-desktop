import crypto from 'node:crypto';

import { BrowserWindow, dialog, net } from 'electron';

import { ScrobblerBase } from './base';

import type { ScrobblerPluginConfig } from '../index';
import type { SetConfType } from '../main';

import type { SongInfo } from '@/providers/song-info';

interface LibreFmSongData {
  track?: string;
  duration?: number;
  artist?: string;
  album?: string;
  method: string;
  timestamp?: number;
}

// Libre.fm uses a special API key - you should register your own at https://libre.fm/api/account
// For now using a generic test key
const LIBREFM_API_KEY = 'test';
const LIBREFM_API_SECRET = 'test';

// Guards against multiple simultaneous re-auth flows triggered by concurrent error-9 responses
let librefmAuthPromise: Promise<ScrobblerPluginConfig> | null = null;

/**
 * Decode HTML entities in a string
 */
const decodeHtmlEntities = (text: string): string => {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&'); // Must be last to avoid double-decoding (e.g. &amp;lt; -> &lt; -> <)
};

export class LibreFmScrobbler extends ScrobblerBase {
  override isSessionCreated(config: ScrobblerPluginConfig): boolean {
    return !!config.scrobblers.librefm.sessionKey;
  }

  override async createSession(
    config: ScrobblerPluginConfig,
    setConfig: SetConfType,
  ): Promise<ScrobblerPluginConfig> {
    try {
      // Step 1: Get a token
      const tokenParams: Record<string, string> = {
        method: 'auth.gettoken',
        api_key: LIBREFM_API_KEY,
        format: 'json',
      };

      const tokenSig = createApiSig(tokenParams, LIBREFM_API_SECRET);
      const tokenUrl = `${config.scrobblers.librefm.apiRoot}?${createQueryString(tokenParams, tokenSig)}`;

      const tokenResponse = await net.fetch(tokenUrl);
      const tokenText = await tokenResponse.text();

      let token: string;
      let tokenParsedAsJson = false;
      try {
        const tokenJson = JSON.parse(tokenText) as {
          token?: string;
          error?: number;
          message?: string;
        };
        tokenParsedAsJson = true;
        if (tokenJson.error || !tokenJson.token) {
          throw new Error(
            tokenJson.message ??
              `API error ${tokenJson.error ?? 'unknown'}: Failed to get authentication token`,
          );
        }
        token = tokenJson.token;
      } catch (err) {
        if (tokenParsedAsJson) {
          // JSON parsed successfully but contained an API error — propagate it
          throw err;
        }
        // JSON.parse itself failed — try XML fallback
        const tokenMatch = tokenText.match(/<token>([^<]+)<\/token>/);
        if (!tokenMatch) {
          throw new Error('Failed to parse token from response');
        }
        token = tokenMatch[1];
      }

      // Step 2: Open browser for user to authorize
      const authUrl = `https://libre.fm/api/auth/?api_key=${LIBREFM_API_KEY}&token=${token}`;
      const authWindow = new BrowserWindow({
        width: 600,
        height: 700,
        webPreferences: {
          nodeIntegration: false,
        },
      });

      await authWindow.loadURL(authUrl);

      // Wait for user to authorize
      await new Promise<void>((resolve) => {
        authWindow.on('closed', () => resolve());
      });

      // Step 3: Get session key
      const sessionParams: Record<string, string> = {
        method: 'auth.getsession',
        api_key: LIBREFM_API_KEY,
        token: token,
        format: 'json',
      };

      const sessionSig = createApiSig(sessionParams, LIBREFM_API_SECRET);
      const sessionUrl = `${config.scrobblers.librefm.apiRoot}?${createQueryString(sessionParams, sessionSig)}`;

      const sessionResponse = await net.fetch(sessionUrl);
      const sessionText = await sessionResponse.text();

      let sessionParsedAsJson = false;
      try {
        const sessionJson = JSON.parse(sessionText) as {
          session?: { key: string; name: string };
          error?: number;
          message?: string;
        };
        sessionParsedAsJson = true;
        if (sessionJson.error || !sessionJson.session) {
          throw new Error(
            sessionJson.message ??
              `API error ${sessionJson.error ?? 'unknown'}: Failed to get session key`,
          );
        }
        config.scrobblers.librefm.sessionKey = sessionJson.session.key;
        await setConfig(config);

        dialog.showMessageBox({
          title: 'Libre.fm Authentication Successful',
          message: `Successfully authenticated as ${sessionJson.session.name}!`,
          type: 'info',
        });
      } catch (err) {
        if (sessionParsedAsJson) {
          // JSON parsed successfully but contained an API error — propagate it
          throw err;
        }
        // JSON.parse itself failed — try XML fallback
        const keyMatch = sessionText.match(/<key>([^<]+)<\/key>/);
        const nameMatch = sessionText.match(/<name>([^<]+)<\/name>/);

        if (keyMatch) {
          config.scrobblers.librefm.sessionKey = keyMatch[1];
          await setConfig(config);

          dialog.showMessageBox({
            title: 'Libre.fm Authentication Successful',
            message: `Successfully authenticated${nameMatch ? ` as ${nameMatch[1]}` : ''}!`,
            type: 'info',
          });
        } else {
          throw new Error('Failed to parse session from response');
        }
      }
    } catch (error) {
      console.error('Libre.fm authentication error:', error);
      dialog.showMessageBox({
        title: 'Libre.fm Authentication Failed',
        message: `Error: ${String(error)}`,
        type: 'error',
      });
    }

    return config;
  }

  override setNowPlaying(
    songInfo: SongInfo,
    config: ScrobblerPluginConfig,
    setConfig: SetConfType,
  ): void {
    if (!config.scrobblers.librefm.sessionKey) {
      return;
    }

    const data = {
      method: 'track.updateNowPlaying',
    };
    this.postSongDataToAPI(songInfo, config, data, setConfig);
  }

  override addScrobble(
    songInfo: SongInfo,
    config: ScrobblerPluginConfig,
    setConfig: SetConfType,
  ): void {
    if (!config.scrobblers.librefm.sessionKey) {
      return;
    }

    const elapsedMs = (songInfo.elapsedSeconds ?? 0) * 1000;
    const data = {
      method: 'track.scrobble',
      timestamp: Math.trunc((Date.now() - elapsedMs) / 1000),
    };
    this.postSongDataToAPI(songInfo, config, data, setConfig);
  }

  private async postSongDataToAPI(
    songInfo: SongInfo,
    config: ScrobblerPluginConfig,
    data: LibreFmSongData,
    setConfig: SetConfType,
  ): Promise<void> {
    if (!config.scrobblers.librefm.sessionKey) {
      return;
    }

    // Get raw title and artist
    const rawTitle =
      config.alternativeTitles && songInfo.alternativeTitle !== undefined
        ? songInfo.alternativeTitle
        : songInfo.title;

    const rawArtist =
      config.alternativeArtist && songInfo.tags?.at(0) !== undefined
        ? songInfo.tags?.at(0)
        : songInfo.artist;

    // Decode HTML entities (handle undefined values)
    const title = rawTitle ? decodeHtmlEntities(rawTitle) : '';
    const artist = rawArtist ? decodeHtmlEntities(rawArtist) : '';

    const postData: Record<string, string | number | undefined> = {
      ...data,
      track: title,
      artist: artist,
      format: 'json',
      api_key: LIBREFM_API_KEY,
      sk: config.scrobblers.librefm.sessionKey,
    };

    if (songInfo.songDuration) {
      postData.duration = songInfo.songDuration;
    }

    if (songInfo.album) {
      postData.album = decodeHtmlEntities(songInfo.album);
    }

    // Filter out undefined values
    const cleanedData = Object.fromEntries(
      Object.entries(postData).filter(([_, v]) => v !== undefined),
    ) as Record<string, string | number>;

    const apiSignature = createApiSig(cleanedData, LIBREFM_API_SECRET);

    const dataWithSig: Record<string, string | number> = {
      ...cleanedData,
      api_sig: apiSignature,
    };

    const formData = createFormData(dataWithSig);

    try {
      const response = await net.fetch(config.scrobblers.librefm.apiRoot, {
        method: 'POST',
        body: formData,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      const text = await response.text();

      // Fix 2: Log only HTTP status + non-sensitive fields; never log raw body
      // which may contain tokens, session keys, or other credentials.
      let json: { error?: number; message?: string } | undefined;
      try {
        json = JSON.parse(text) as { error?: number; message?: string };
        const SENSITIVE_KEYS = new Set([
          'token',
          'session',
          'key',
          'auth',
          'secret',
          'sk',
          'api_key',
          'api_sig',
        ]);
        const safeSummary = Object.fromEntries(
          Object.entries(json).filter(
            ([k]) => !SENSITIVE_KEYS.has(k.toLowerCase()),
          ),
        );
        console.log(
          `Libre.fm ${data.method} response: HTTP ${response.status}`,
          safeSummary,
        );
      } catch {
        // Response is not JSON — log status only, never the raw body
        console.log(
          `Libre.fm ${data.method} response: HTTP ${response.status} (non-JSON)`,
        );
      }

      if (json?.error === 9) {
        // Session expired — clear key and restart the auth flow, but guard against
        // multiple simultaneous re-auth flows from concurrent error-9 responses.
        console.log('Libre.fm session expired, restarting auth flow');
        config.scrobblers.librefm.sessionKey = undefined;
        await setConfig(config);
        if (!librefmAuthPromise) {
          librefmAuthPromise = this.createSession(config, setConfig).finally(
            () => {
              librefmAuthPromise = null;
            },
          );
        }
        librefmAuthPromise.catch((error: unknown) => {
          console.error('Libre.fm re-authentication failed:', error);
          setConfig(config);
        });
      } else if (json?.error) {
        console.error(
          `Libre.fm ${data.method} error:`,
          json.message || json.error,
        );
      }
    } catch (error) {
      console.error(`Libre.fm ${data.method} error:`, error);
    }
  }
}

const createFormData = (parameters: Record<string, string | number>) => {
  const formData = new URLSearchParams();
  for (const [key, value] of Object.entries(parameters)) {
    formData.append(key, String(value));
  }
  return formData;
};

const createQueryString = (
  parameters: Record<string, string | number>,
  apiSignature: string,
) => {
  const allParams: Record<string, string | number> = {
    ...parameters,
    api_sig: apiSignature,
  };

  const queryData = Object.entries(allParams).map(
    ([key, value]) =>
      `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
  );

  return queryData.join('&');
};

const createApiSig = (
  parameters: Record<string, string | number>,
  secret: string,
) => {
  let sig = '';

  Object.entries(parameters)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([key, value]) => {
      if (key === 'format' || key === 'callback') {
        return;
      }
      sig += key + value;
    });

  sig += secret;
  return crypto.createHash('md5').update(sig, 'utf-8').digest('hex');
};
