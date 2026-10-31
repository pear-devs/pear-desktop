import {
  BrowserWindow,
  session,
  type Session,
  type WebContents,
  type WebPreferences,
} from 'electron';

// Workaround for MusixMatch refusing to hand out anonymous tokens (token.get).
// The user logs in on musixmatch.com inside an isolated window, and we capture the
// user token that the website uses for the logged-in session.
//
// Sources (in order of preference):
//   1. the `musixmatchUserToken` cookie (only set once the user is logged in)
//   2. the `userToken` embedded in the website's HTML (`__NEXT_DATA__`)

const PARTITION = 'persist:synced-lyrics-musixmatch';

// Shared by the login window and every popup it opens (e.g. OAuth providers)
const LOGIN_WEB_PREFERENCES: WebPreferences = {
  partition: PARTITION,
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
};
const HOME_URL = 'https://www.musixmatch.com/';
const COOKIE_NAME = 'musixmatchUserToken';
const DEFAULT_APP_ID = 'web-desktop-app-v1.0';

export interface MusixMatchLogin {
  token: string;
  /** The app id the token belongs to (if known) */
  appId?: string;
}

/**
 * The cookie value is usually a (url-encoded) JSON object that maps app ids to tokens,
 * e.g. `{"web-desktop-app-v1.0":"<token>"}`. A plain token string is accepted as well.
 */
const TOKEN_RE = /^[\w-]{16,}$/;

/** Decodes url-encoding (possibly repeated) and JSON (possibly nested in strings). */
const decodeValue = (raw: string): unknown => {
  let value: unknown = raw;
  for (let i = 0; i < 4 && typeof value === 'string'; i++) {
    const text: string = value;
    try {
      const decoded = decodeURIComponent(text);
      if (decoded !== text) {
        value = decoded;
        continue;
      }
    } catch {
      // not url-encoded
    }

    try {
      value = JSON.parse(text);
    } catch {
      break;
    }
  }
  return value;
};

/** Collects every token-like string found in a decoded value, with the key it was found under. */
const collectTokens = (
  value: unknown,
  key = '',
  out: { key: string; token: string }[] = [],
  depth = 0,
) => {
  if (depth > 8) return out;

  if (typeof value === 'string') {
    if (TOKEN_RE.test(value)) out.push({ key, token: value });
  } else if (Array.isArray(value)) {
    for (const item of value) collectTokens(item, key, out, depth + 1);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      collectTokens(v, k, out, depth + 1);
    }
  }
  return out;
};

/** Describes the structure of a cookie value without leaking the token itself. */
export const describeCookieShape = (raw: string): string => {
  const shape = (value: unknown, depth = 0): string => {
    if (typeof value === 'string') return `string(${value.length})`;
    if (depth > 6) return '...';
    if (Array.isArray(value)) {
      return `[${value.map((v) => shape(v, depth + 1)).join(',')}]`;
    }
    if (value && typeof value === 'object') {
      return `{${Object.entries(value)
        .map(([k, v]) => `${k}:${shape(v, depth + 1)}`)
        .join(',')}}`;
    }
    return typeof value;
  };
  return shape(decodeValue(raw));
};

/**
 * The cookie value is a url-encoded JSON value that holds one token per app id:
 * `{"tokens":{"mxm-com-v1.0":"<token>","web-desktop-app-v1.0":"<token>", ...}}`.
 * A plain token string is accepted as well.
 */
export const parseUserTokenCookie = (raw: string): MusixMatchLogin | null => {
  const found = collectTokens(decodeValue(raw));
  if (found.length === 0) return null;

  const pick = (predicate: (key: string) => boolean) =>
    found.find((f) => predicate(f.key));

  const best =
    pick((k) => k === 'mxm-com-v1.0') ??
    pick((k) => k === DEFAULT_APP_ID) ??
    pick((k) => /-v\d/.test(k) && !/-dev$|-pp$/.test(k)) ??
    pick((k) => /-v\d/.test(k));

  if (best) return { token: best.token, appId: best.key };
  return { token: found[0].token };
};

const readCookie = async (ses: Session): Promise<MusixMatchLogin | null> => {
  const cookies = await ses.cookies.get({});
  for (const cookie of cookies) {
    if (!cookie.domain?.endsWith('musixmatch.com')) continue;
    if (cookie.name.toLowerCase() !== COOKIE_NAME.toLowerCase()) continue;

    const login = parseUserTokenCookie(cookie.value);
    if (login) return login;
  }
  return null;
};

/** Reads the token that the website embeds in its HTML when the session is logged in. */
const readEmbeddedToken = async (
  ses: Session,
): Promise<MusixMatchLogin | null> => {
  try {
    const html = await (await ses.fetch(HOME_URL)).text();
    const match = /"auth":\{[^}]*?"userToken":"([^"]+)"/.exec(html);
    if (!match) return null;

    const appId = /"auth":\{[^}]*?"appId":"([^"]+)"/.exec(html)?.[1];
    return { token: match[1], appId };
  } catch (error) {
    console.error('[synced-lyrics] Failed to read embedded token', error);
    return null;
  }
};

/** Names (never values) of the musixmatch cookies, to help diagnose failures. */
const describeCookies = async (ses: Session) => {
  const cookies = await ses.cookies.get({});
  return cookies
    .filter((c) => c.domain?.endsWith('musixmatch.com'))
    .map((c) =>
      c.name.toLowerCase() === COOKIE_NAME.toLowerCase()
        ? `${c.name} [shape: ${describeCookieShape(c.value)}]`
        : c.name,
    );
};

let loginWindow: BrowserWindow | null = null;
let pendingLogin: Promise<MusixMatchLoginResult> | null = null;
// Bumped by `logoutFromMusixMatch`, every login attempt remembers the value it started with
// and must not hand out or keep credentials once it no longer matches.
let loginGeneration = 0;

export interface MusixMatchLoginResult {
  login: MusixMatchLogin | null;
  /** cookie names seen on musixmatch.com, for diagnostics */
  cookieNames: string[];
  /** the attempt was invalidated by a logout, so there is nothing to report to the user */
  cancelled?: boolean;
}

/**
 * Opens the MusixMatch website in an isolated window so the user can log in.
 * Resolves as soon as a token is detected (the window is closed automatically),
 * or when the user closes the window.
 */
export const loginToMusixMatch = (
  parent?: BrowserWindow,
): Promise<MusixMatchLoginResult> => {
  if (pendingLogin) {
    loginWindow?.focus();
    return pendingLogin;
  }

  const generation = loginGeneration;
  const isCurrent = () => generation === loginGeneration;
  const cancelledResult = (): MusixMatchLoginResult => ({
    login: null,
    cookieNames: [],
    cancelled: true,
  });

  pendingLogin = (async () => {
    // start from a clean session, otherwise a stale cookie from an earlier login
    // would be detected immediately and the window would close while still loading
    await session.fromPartition(PARTITION).clearStorageData();

    // logged out while the session was being cleared
    if (!isCurrent()) return cancelledResult();

    return new Promise<MusixMatchLoginResult>((resolve) => {
      const ses = session.fromPartition(PARTITION);
      let finished = false;

      const win = new BrowserWindow({
        width: 520,
        height: 760,
        parent,
        title: 'MusixMatch login',
        autoHideMenuBar: true,
        webPreferences: { ...LOGIN_WEB_PREFERENCES },
      });
      loginWindow = win;

      const finish = async (login: MusixMatchLogin | null) => {
        if (finished) return;
        finished = true;

        clearInterval(poll);
        ses.cookies.removeListener('changed', check);

        let cookieNames: string[] = [];
        if (isCurrent()) {
          try {
            // closing from the user side: try the remaining sources
            login ??= (await readCookie(ses)) ?? (await readEmbeddedToken(ses));
            cookieNames = await describeCookies(ses);
          } catch (error) {
            console.error('[synced-lyrics] MusixMatch login failed', error);
          }
        }

        // a logout may have happened while the reads above were in flight,
        // in that case whatever was read belongs to a session that no longer exists
        const cancelled = !isCurrent();
        if (cancelled) {
          login = null;
          cookieNames = [];
        }

        if (loginWindow === win) loginWindow = null;
        if (!win.isDestroyed()) win.destroy();
        resolve({ login, cookieNames, cancelled });
      };

      // cookie, set by the website once the user is logged in
      const check = async () => {
        if (finished) return;
        try {
          const login = await readCookie(ses);
          if (login) await finish(login);
        } catch {
          // ignore, try again later
        }
      };
      ses.cookies.on('changed', check);
      const poll = setInterval(check, 2000);

      // Google/other OAuth providers reject user agents that contain "Electron".
      const userAgent = win.webContents.userAgent.replace(
        /\s(Electron|pear-desktop)\/\S+/gi,
        '',
      );

      // Popups (e.g. the OAuth window) get the same hardened options as the login
      // window and are children of it, so they are closed together with it.
      const hardenPopups = (contents: WebContents, owner: BrowserWindow) => {
        contents.setUserAgent(userAgent);
        contents.setWindowOpenHandler(({ url }) =>
          url.startsWith('https://')
            ? {
                action: 'allow',
                overrideBrowserWindowOptions: {
                  parent: owner,
                  autoHideMenuBar: true,
                  webPreferences: { ...LOGIN_WEB_PREFERENCES },
                },
              }
            : { action: 'deny' },
        );
        contents.on('did-create-window', (popup) =>
          hardenPopups(popup.webContents, popup),
        );
      };
      hardenPopups(win.webContents, win);

      // Keep the title stable, the page title would replace it.
      win.on('page-title-updated', (event) => event.preventDefault());
      win.on('close', (event) => {
        if (finished) return;
        // let `finish` collect the token first, it destroys the window afterwards
        event.preventDefault();
        finish(null).catch(() => {});
      });

      win.loadURL(HOME_URL).catch((error) => {
        // the load is aborted when the window gets closed, that is expected
        if (finished || win.isDestroyed()) return;
        console.error('[synced-lyrics] Failed to load MusixMatch', error);
      });
    });
  })().finally(() => {
    pendingLogin = null;
  });

  return pendingLogin;
};

/**
 * Cancels a pending login (if any) and removes the cookies/storage of the isolated session.
 * The pending attempt is closed through the window's own close path and resolves without
 * credentials, the storage is only cleared once it has settled.
 */
export const logoutFromMusixMatch = async () => {
  loginGeneration++;

  const pending = pendingLogin;
  if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close();
  await pending?.catch(() => {});

  await session.fromPartition(PARTITION).clearStorageData();
};
