import { runInContext } from 'node:vm';

import {
  BG,
  base64ToU8,
  buildURL,
  getHeaders,
  u8ToBase64,
  type WebPoSignalOutput,
} from 'bgutils-js';
import { Platform, type Types } from 'youtubei.js';

import { getNetFetchAsFetch } from './fetch';

// youtubei.js ships no JavaScript evaluator, and deciphering stream URLs needs one
// https://ytjs.dev/guide/getting-started.html#providing-a-custom-javascript-interpreter
export const setupYoutubeiEvaluator = () => {
  Platform.shim.eval = (
    data: Types.BuildScriptResult,
    env: Record<string, Types.VMPrimative>,
  ) => {
    const properties = [];

    if (env.n) {
      properties.push(`n: exportedVars.nFunction("${env.n}")`);
    }

    if (env.sig) {
      properties.push(`sig: exportedVars.sigFunction("${env.sig}")`);
    }

    const code = `${data.output}\nreturn { ${properties.join(', ')} }`;

    // oxlint-disable-next-line typescript/no-unsafe-return,typescript/no-implied-eval,typescript/no-unsafe-call
    return new Function(code)();
  };
};

const requestKey = 'O43z0dpjhgX20SCx4KAo';

type PoTokenMinter = {
  expiresAt: number;
  mint: (identifier: string) => Promise<string>;
  close: () => Promise<void>;
};

const createPoTokenMinter = async (
  visitorData: string,
): Promise<PoTokenMinter> => {
  const fetch = getNetFetchAsFetch();
  // BotGuard runs inside happy-dom's own VM context, so the main process globals stay untouched
  const window = new (await import('happy-dom')).Window();

  try {
    const bgConfig = {
      fetch,
      globalObj: window,
      identifier: visitorData,
      requestKey,
    };
    const challenge = await BG.Challenge.create(bgConfig);
    const interpreterJavascript =
      challenge?.interpreterJavascript
        .privateDoNotAccessOrElseSafeScriptWrappedValue;
    if (!challenge || !interpreterJavascript) {
      throw new Error('Could not get the BotGuard challenge');
    }

    runInContext(interpreterJavascript, window);
    const botguard = await BG.BotGuardClient.create({
      program: challenge.program,
      globalName: challenge.globalName,
      globalObj: window,
    });

    // Must come from the VM realm, BotGuard only fills arrays of its own realm
    const webPoSignalOutput = runInContext('[]', window) as WebPoSignalOutput;
    const botguardResponse = await botguard.snapshot({ webPoSignalOutput });
    const response = await fetch(buildURL('GenerateIT'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify([requestKey, botguardResponse]),
    });
    const [integrityToken, estimatedTtlSecs] = (await response.json()) as [
      string,
      number,
    ];
    const ttlMs = estimatedTtlSecs * 1000;

    // BG.WebPoMinter rejects functions and Uint8Arrays from the VM realm (`instanceof` checks),
    // so call the minter directly
    const mintCallback = await webPoSignalOutput[0]?.(
      base64ToU8(integrityToken),
    );
    if (typeof mintCallback !== 'function') {
      throw new Error('Could not create the PO token minter');
    }

    return {
      expiresAt: Date.now() + ttlMs,
      async mint(identifier) {
        const token = await mintCallback(new TextEncoder().encode(identifier));
        if (!token) {
          throw new Error('Could not mint a PO token');
        }

        return u8ToBase64(new Uint8Array(token), true);
      },
      close: () => window.happyDOM.close(),
    };
  } catch (error) {
    await window.happyDOM.close();
    throw error;
  }
};

const createPoTokenMinterWithRetry = async (visitorData: string) => {
  // BotGuard randomly fails to produce a minter (about half the time under happy-dom)
  for (let attempt = 1; attempt < 5; attempt++) {
    try {
      return await createPoTokenMinter(visitorData);
    } catch {}
  }

  return await createPoTokenMinter(visitorData);
};

let cachedMinter:
  | { visitorData: string; minter: Promise<PoTokenMinter> }
  | undefined;

/**
 * Mints a PO token bound to `identifier` (e.g. a video ID).
 * Stream URLs of the YTMUSIC client need one bound to the video ID, otherwise
 * googlevideo answers 403 past the first megabyte.
 */
export const mintPoToken = async (
  visitorData: string,
  identifier: string,
): Promise<string> => {
  if (cachedMinter?.visitorData !== visitorData) {
    cachedMinter?.minter.then(
      (minter) => minter.close(),
      () => {},
    );
    cachedMinter = {
      visitorData,
      minter: createPoTokenMinterWithRetry(visitorData),
    };
  }

  const current = cachedMinter;
  let minter;
  try {
    minter = await current.minter;
  } catch (error) {
    if (cachedMinter === current) cachedMinter = undefined;
    throw error;
  }

  if (Date.now() < minter.expiresAt) {
    return await minter.mint(identifier);
  }

  if (cachedMinter === current) cachedMinter = undefined;
  minter.close();
  return await mintPoToken(visitorData, identifier);
};
