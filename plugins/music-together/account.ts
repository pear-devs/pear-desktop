// The signed-in account, for the user's profile in a session, as pear-desktop
// did. pear-desktop opened YTM's account menu and read its header; this asks
// YTM's API for the same menu instead, so nothing pops open.

import type { Account } from "./types.ts";

export interface AppElement extends HTMLElement {
  networkManager?: { fetch<T>(path: string, body: unknown): Promise<T> };
}

type Runs = { runs?: { text?: string }[] };

/** The header of YTM's account menu (pear-desktop read it from `ytd-active-account-header-renderer`). */
interface AccountHeader {
  accountName?: Runs;
  channelHandle?: Runs;
  accountPhoto?: { thumbnails?: { url?: string }[] };
}

const HEADER_KEY = "activeAccountHeaderRenderer";

const text = (runs: Runs | undefined) => runs?.runs?.map((run) => run.text ?? "").join("").trim() || undefined;

/** Finds the account header anywhere in an account menu response. */
function findHeader(value: unknown, depth = 0): AccountHeader | undefined {
  if (typeof value !== "object" || value === null || depth > 12) return undefined;
  if (HEADER_KEY in value) return (value as Record<string, AccountHeader>)[HEADER_KEY];
  for (const child of Object.values(value)) {
    const found = findHeader(child, depth + 1);
    if (found) return found;
  }
  return undefined;
}

/** The profile in YTM's account menu response, or `null` without one (signed out). */
export function accountFromMenu(response: unknown): Account | null {
  const header = findHeader(response);
  const name = text(header?.accountName);
  if (!header || !name) return null;
  return {
    handleId: text(header.channelHandle) ?? name,
    name,
    thumbnail: header.accountPhoto?.thumbnails?.find((thumbnail) => thumbnail.url)?.url ?? "",
  };
}

const signedIn = () => {
  const page = window as unknown as { ytcfg?: { get?(key: string): unknown; data_?: { LOGGED_IN?: boolean } } };
  return (page.ytcfg?.get?.("LOGGED_IN") ?? page.ytcfg?.data_?.LOGGED_IN) === true;
};

/** The signed-in account, or `null` when signed out (or YTM's API didn't answer). */
export async function fetchAccount(app: AppElement | null): Promise<Account | null> {
  if (!signedIn() || !app?.networkManager) return null;
  return accountFromMenu(await app.networkManager.fetch<unknown>("/account/account_menu", {}));
}
