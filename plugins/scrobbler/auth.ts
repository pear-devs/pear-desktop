// Last.fm authorization: the user signs in and approves in a Last.fm window.

import { BrowserWindow, dialog } from "electron";
import { credentials, netFetch, type Warn } from "./common.ts";
import type { Ctx } from "./schema.ts";
import { lastFm } from "./services.ts";

const AUTH_POLL_MS = 2000;
/** Fits Last.fm's sign-in and approval pages. */
const AUTH_WINDOW_SIZE = { width: 520, height: 680 };

interface AuthWindow {
  window: BrowserWindow;
  poll?: ReturnType<typeof setTimeout>;
}

export function lastFmAuthorizer(ctx: Ctx, warn: Warn) {
  let auth: AuthWindow | undefined;
  let authDeclined = false;
  let stopped = false;

  const authorize = async () => {
    if (auth || authDeclined || !ctx.config.lastfmEnabled || ctx.config.lastfmSessionKey) return;
    let token: string;
    try {
      token = await lastFm.getToken(netFetch, credentials(ctx));
    } catch (error) {
      warn("Last.fm", error);
      return;
    }
    const window = new BrowserWindow({
      parent: ctx.window,
      modal: true,
      ...AUTH_WINDOW_SIZE,
      title: ctx.t("plugins.scrobbler.auth-window.title", "Authorize Pear Desktop on Last.fm"),
      autoHideMenuBar: true,
      minimizable: false,
      maximizable: false,
      webPreferences: { partition: "persist:pear-lastfm", sandbox: true, contextIsolation: true },
    });
    const current: AuthWindow = { window };
    auth = current;
    let authorized = false;
    // Last.fm has no redirect for desktop apps: poll until the token is approved.
    const poll = () => {
      current.poll = ctx.setTimeout(async () => {
        try {
          const session = await lastFm.getSession(netFetch, credentials(ctx), token);
          authorized = true;
          ctx.log.info(`authorized on Last.fm as ${session.name}`);
          ctx.setConfig({ lastfmSessionKey: session.key });
          if (!window.isDestroyed()) window.close();
        } catch {
          if (auth === current) poll();
        }
      }, AUTH_POLL_MS);
    };
    window.on("closed", () => {
      ctx.clearTimeout(current.poll);
      if (auth === current) auth = undefined;
      if (authorized || stopped) return;
      // Don't reopen the window by itself; toggling Last.fm (or clearing the session) asks again.
      authDeclined = true;
      showDeclined(ctx);
    });
    void window.loadURL(lastFm.authUrl(ctx.config.lastfmApiKey, token));
    poll();
  };

  ctx.onCleanup(() => {
    stopped = true;
    const current = auth;
    auth = undefined;
    if (!current) return;
    if (!current.window.isDestroyed()) current.window.close();
  });

  let wasEnabled = ctx.config.lastfmEnabled;
  let hadSession = !!ctx.config.lastfmSessionKey;
  const reconfigure = () => {
    const { lastfmEnabled, lastfmSessionKey } = ctx.config;
    const askAgain = (lastfmEnabled && !wasEnabled) || (hadSession && !lastfmSessionKey);
    if (askAgain) authDeclined = false;
    wasEnabled = lastfmEnabled;
    hadSession = !!lastfmSessionKey;
    void authorize();
  };

  return { authorize, reconfigure };
}

function showDeclined(ctx: Ctx) {
  void dialog.showMessageBox(ctx.window, {
    type: "warning",
    title: ctx.t("plugins.scrobbler.dialog.lastfm.auth-failed.title", "Authentication Failed"),
    message: ctx.t("plugins.scrobbler.dialog.lastfm.not-authorized.message", "Pear Desktop wasn't authorized on Last.fm"),
    detail: ctx.t(
      "plugins.scrobbler.dialog.lastfm.not-authorized.detail",
      "Scrobbling to Last.fm stays off until you authorize. Turn the Last.fm option off and on to try again.",
    ),
  });
}
