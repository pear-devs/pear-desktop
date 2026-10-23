// Host-side helpers the submissions and the authorization share.

import { errorMessage } from "@pear/sdk/util";
import { net } from "electron";
import type { Ctx } from "./schema.ts";
import type { Fetch } from "./services.ts";

export const netFetch: Fetch = (url, init) => net.fetch(url, init);

export const credentials = (ctx: Ctx) => ({
  apiRoot: ctx.config.lastfmApiRoot,
  apiKey: ctx.config.lastfmApiKey,
  secret: ctx.config.lastfmSecret,
});

/** Logs one warning per distinct failure instead of one per track. */
export function warner(ctx: Ctx) {
  let lastWarning = "";
  return (service: string, error: unknown) => {
    const message = `${service}: ${errorMessage(error)}`;
    if (message !== lastWarning) ctx.log.warn(message);
    lastWarning = message;
  };
}

export type Warn = ReturnType<typeof warner>;
