// The page side of the built-in engine: PO tokens, which the site's streams need
// past their first megabyte. BotGuard needs a real DOM, so it runs here (pear-desktop
// faked one with happy-dom in the main process). It refuses to mint inside an
// iframe, so its VM lives on the window for as long as it loads, and whatever
// YTM had under that name is put back afterwards.

import { BG, type BgConfig, buildURL, getHeaders, type WebPoSignalOutput } from "bgutils-js";

/** The site's web client's key for BotGuard's challenge (pear-desktop's and yt-dlp's). */
const REQUEST_KEY = "O43z0dpjhgX20SCx4KAo";
/** Mint again a little before the integrity token expires. */
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

export interface PoTokenRequest {
  /** Whether the host's requests carry the account; the token is then bound to it, else to the visitor. */
  signedIn: boolean;
  /** The last token was refused. */
  refresh: boolean;
  /** The song whose streams the token is for: the site may bind tokens to songs instead of the visitor. */
  videoId?: string | undefined;
}

interface PageConfig {
  LOGGED_IN?: boolean;
  VISITOR_DATA?: string;
  DATASYNC_ID?: string;
  WEB_PLAYER_CONTEXT_CONFIGS?: Record<string, { serializedExperimentFlags?: string }>;
}

const pageConfig = (): PageConfig => {
  const page = window as unknown as { ytcfg?: { data_?: PageConfig }; yt?: { config_?: PageConfig } };
  return page.ytcfg?.data_ ?? page.yt?.config_ ?? {};
};

/** The player's experiment binding stream tokens to the song (yt-dlp reads the same flag). */
const bindsToSong = (config: PageConfig) =>
  Object.values(config.WEB_PLAYER_CONTEXT_CONFIGS ?? {}).some((player) =>
    /(?:^|&)html5_generate_content_po_token=true(?:&|$)/.test(player.serializedExperimentFlags ?? ""),
  );

/** What a token is minted for: the song, the account (signed in) or the visitor. */
function identifierFor(request: PoTokenRequest, config: PageConfig) {
  if (request.videoId && bindsToSong(config)) return request.videoId;
  if (request.signedIn && config.LOGGED_IN) return config.DATASYNC_ID;
  return config.VISITOR_DATA;
}

interface Minter {
  mint(identifier: string): Promise<string>;
  expires: number;
}

/** Answers the host's requests for PO tokens, keeping the minter until its integrity token expires. */
export function poTokens() {
  let minter: Promise<Minter> | undefined;

  const current = async (refresh: boolean) => {
    const existing = await minter?.catch(() => undefined);
    if (existing && !refresh && Date.now() < existing.expires) return existing;
    const created = createMinter();
    minter = created;
    created.catch(() => {
      if (minter === created) minter = undefined;
    });
    return created;
  };

  return {
    async answer(request: PoTokenRequest) {
      const config = pageConfig();
      const identifier = identifierFor(request, config);
      if (!identifier) throw new Error("the page has no visitor or account to bind a PO token to");
      const poToken = await (await current(request.refresh)).mint(identifier);
      return { poToken, visitorData: config.VISITOR_DATA };
    },
    dispose() {
      minter = undefined;
    },
  };
}

async function createMinter(): Promise<Minter> {
  const bgConfig: BgConfig = {
    fetch: (input, init) => fetch(input, init),
    globalObj: window,
    identifier: "",
    requestKey: REQUEST_KEY,
  };
  const challenge = await BG.Challenge.create(bgConfig);
  if (!challenge) throw new Error("BotGuard sent no challenge");
  const script = challenge.interpreterJavascript.privateDoNotAccessOrElseSafeScriptWrappedValue;
  if (!script) throw new Error("BotGuard sent no interpreter");
  const botguard = await withGlobal(challenge.globalName, () => {
    // Defines the VM on the window.
    // oxlint-disable-next-line typescript/no-implied-eval
    new Function(script)();
    return BG.BotGuardClient.create({ program: challenge.program, globalName: challenge.globalName, globalObj: window });
  });
  // BG.PoToken.generate's steps, keeping the minter to mint for any identifier later.
  const webPoSignalOutput: WebPoSignalOutput = [];
  const snapshot = await botguard.snapshot({ webPoSignalOutput });
  const response = await fetch(buildURL("GenerateIT"), {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify([REQUEST_KEY, snapshot]),
  });
  if (!response.ok) throw new Error(`BotGuard's integrity token: HTTP ${response.status}`);
  const [integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken] = (await response.json()) as [string, number, number, string];
  const integrityTokenData = { integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken };
  const minter = await BG.WebPoMinter.create(integrityTokenData, webPoSignalOutput);
  const ttl = (estimatedTtlSecs ?? 0) * 1000;
  return {
    mint: (identifier) => minter.mintAsWebsafeString(identifier),
    expires: Date.now() + Math.max(0, ttl - EXPIRY_MARGIN_MS),
  };
}

/** Runs `step` with whatever it puts on `window[name]` removed afterwards, and YTM's own value back. */
async function withGlobal<T>(name: string, step: () => Promise<T>): Promise<T> {
  const previous = Object.getOwnPropertyDescriptor(window, name);
  try {
    return await step();
  } finally {
    if (previous) Object.defineProperty(window, name, previous);
    else Reflect.deleteProperty(window, name);
  }
}
