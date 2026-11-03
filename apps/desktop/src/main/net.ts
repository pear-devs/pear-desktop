// Core request rewriting, registered through the webRequest router so plugins
// (ad blockers, proxies) compose with it.

import type { WebRequest } from "electron";
import { GOOGLE_AUTH_ORIGIN, YTM_ORIGIN } from "../shared/user-agent.ts";

const STRIPPED_RESPONSE_HEADERS = new Set([
  "content-security-policy",
  "content-security-policy-report-only",
]);

export interface NetOptions {
  /** Electron's unmodified UA, sent to Google sign-in. */
  electronUserAgent: string;
}

export function setupNet(webRequest: WebRequest, { electronUserAgent }: NetOptions) {
  // YTM's CSP (incl. Trusted Types) would block the page runtime and plugin code.
  webRequest.onHeadersReceived({ urls: [`${YTM_ORIGIN}/*`] }, (details, callback) => {
    const responseHeaders: Record<string, string[]> = {};
    for (const [name, value] of Object.entries(details.responseHeaders ?? {})) {
      if (!STRIPPED_RESPONSE_HEADERS.has(name.toLowerCase())) responseHeaders[name] = value;
    }
    callback({ responseHeaders });
  });

  // Covers sign-in XHRs and subresources; the window switches the navigator UA.
  webRequest.onBeforeSendHeaders({ urls: [`${GOOGLE_AUTH_ORIGIN}/*`] }, (details, callback) => {
    callback({ requestHeaders: { ...details.requestHeaders, "User-Agent": electronUserAgent } });
  });
}
