// Where links and navigations of the main window go: YTM and Google sign-in
// stay in the app, other web pages open in the browser, anything else nowhere.
// Pure, so it needs no Electron (unit tests).

import { GOOGLE_AUTH_ORIGIN, YTM_ORIGIN } from "../shared/user-agent.ts";

/** The video site YTM belongs to (its sign-in redirects and consent page live there). */
const VIDEO_SITE = new URL(YTM_ORIGIN).hostname.replace(/^music\./, "");

/** Origins the sign-in, consent and sign-out flows pass through on their way back to YTM. */
const AUTH_ORIGINS = new Set([
  GOOGLE_AUTH_ORIGIN,
  `https://accounts.${VIDEO_SITE}`,
  "https://consent.google.com",
  `https://consent.${VIDEO_SITE}`,
  // Account checkups ("protect your account") Google shows during sign-in.
  "https://gds.google.com",
]);

/** The video site's own pages that only hand the session over to YTM. */
const VIDEO_SITE_ORIGIN = `https://www.${VIDEO_SITE}`;
const AUTH_PATHS = new Set(["/signin", "/logout"]);

export type WindowOpenAction = "load" | "external" | "deny";
export type NavigationAction = "allow" | "external" | "deny";

function isWeb(url: URL) {
  return url.protocol === "https:" || url.protocol === "http:";
}

function isAuthFlow(url: URL) {
  if (AUTH_ORIGINS.has(url.origin)) return true;
  return url.origin === VIDEO_SITE_ORIGIN && AUTH_PATHS.has(url.pathname);
}

/** A new window the page asked for (target=_blank, middle or Ctrl+click, window.open). */
export function windowOpenAction(url: string): WindowOpenAction {
  const parsed = URL.parse(url);
  if (!parsed || !isWeb(parsed)) return "deny";
  return parsed.origin === YTM_ORIGIN ? "load" : "external";
}

/** A navigation the main window's page started (links, location changes, form posts). */
export function navigationAction(url: string): NavigationAction {
  const parsed = URL.parse(url);
  if (!parsed || !isWeb(parsed)) return "deny";
  if (parsed.origin === YTM_ORIGIN || isAuthFlow(parsed)) return "allow";
  return "external";
}
