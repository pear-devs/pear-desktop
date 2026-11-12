// The signed-in session's cookies for yt-dlp (pear-desktop downloaded with the
// window's session), written as a Netscape cookies file. Never logged.

export interface CookieLike {
  domain?: string;
  hostOnly?: boolean;
  path?: string;
  secure?: boolean;
  expirationDate?: number;
  name: string;
  value: string;
}

/** The video site's (and YTM's) cookies; nothing else from the session goes to yt-dlp. */
export const isSiteCookie = (cookie: CookieLike) =>
  /(^|\.)\u0079\u006f\u0075\u0074\u0075\u0062\u0065\.com$/.test((cookie.domain ?? "").replace(/^\./, ""));

/** The Netscape cookies file format yt-dlp reads with --cookies. */
export function toNetscape(cookies: readonly CookieLike[]) {
  const lines = ["# Netscape HTTP Cookie File", ""];
  for (const cookie of cookies) {
    if (!cookie.domain || /[\t\n\r]/.test(cookie.name + cookie.value)) continue;
    const domain = cookie.hostOnly || cookie.domain.startsWith(".") ? cookie.domain : `.${cookie.domain}`;
    lines.push(
      [
        domain,
        domain.startsWith(".") ? "TRUE" : "FALSE",
        cookie.path ?? "/",
        cookie.secure ? "TRUE" : "FALSE",
        String(Math.floor(cookie.expirationDate ?? 0)),
        cookie.name,
        cookie.value,
      ].join("\t"),
    );
  }
  return `${lines.join("\n")}\n`;
}
