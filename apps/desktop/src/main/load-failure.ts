// What the main window does when a page fails to load: pear-desktop's error
// page with a Retry, or (offline) the home page, which the site's service worker
// serves from its cache.

import { isYtmUrl } from "../shared/user-agent.ts";

/**
 * Chromium's errors for a page that failed to load for want of a network
 * (net_error_list.h); the site's service worker turns those into ERR_FAILED (-2).
 */
const OFFLINE_ERRORS = new Set([-2, -21, -105, -106, -109, -118, -137]);
/** ERR_ABORTED: a navigation replaced by another one, not a failure (as pear-desktop). */
const ABORTED = -3;

/** What to do when the main frame fails to load `url`. */
export function loadFailureAction(errorCode: number, url: string): "ignore" | "home" | "error-page" {
  const parsed = URL.parse(url);
  // pear-desktop skipped ad frames (its #2435) and its own error page.
  if (errorCode === ABORTED || !parsed || parsed.protocol === "data:" || parsed.hostname.endsWith("doubleclick.net")) return "ignore";
  // Offline, the site's service worker answers for its home page only (from its
  // cached app shell, with the Downloads page a click away).
  if (OFFLINE_ERRORS.has(errorCode) && isYtmUrl(url) && parsed.pathname !== "/") return "home";
  return "error-page";
}

/** pear-desktop's error page, whose Retry loads `url` again. */
export function errorPage(url: string, text: { title: string; message: string; retry: string }) {
  const html = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
  const page = `<!doctype html><html><head><meta charset="utf-8"><title>${html(text.title)}</title><style>
body{background:#000;margin:0}
.container{font-family:Roboto,Arial,sans-serif;font-size:20px;font-weight:500;color:rgba(255,255,255,.5);position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center}
.button{background:#065fd4;color:#fff;font:inherit;font-size:16px;font-weight:400;text-transform:uppercase;text-decoration:none;border-radius:2px;padding:8px 22px;display:inline-block}
</style></head><body><div class="container"><p>${html(text.message)}</p><a class="button" href="${html(url)}">${html(text.retry)}</a></div></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(page)}`;
}
