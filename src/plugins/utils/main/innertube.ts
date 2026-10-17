import { Mutex } from 'async-mutex';
import { BG, type BgConfig } from 'bgutils-js';
import { Innertube, Platform, UniversalCache, type Types } from 'youtubei.js';

import { getNetFetchAsFetch } from './fetch';

import type { BrowserWindow } from 'electron';

const evalShim = (
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

/** BotGuard runs on globalThis.window / document, one setup at a time */
const globalsMutex = new Mutex();

export const getCookieFromWindow = async (win: BrowserWindow) => {
  return (
    await win.webContents.session.cookies.get({
      url: 'https://music.youtube.com',
    })
  )
    .map((it) => it.name + '=' + it.value)
    .join(';');
};

/**
 * Creates an Innertube client using the window's cookies, with a PO token
 * generated through BotGuard when possible (needed to fetch streams).
 */
export const createInnertube = async (win: BrowserWindow) => {
  Platform.shim.eval = evalShim;

  const yt = await Innertube.create({
    cache: new UniversalCache(false),
    cookie: await getCookieFromWindow(win),
    generate_session_locally: true,
    fetch: getNetFetchAsFetch(),
  });

  const requestKey = 'O43z0dpjhgX20SCx4KAo';
  const visitorData = yt.session.context.client.visitorData;

  if (visitorData) {
    await globalsMutex.runExclusive(async () => {
      const cleanUp = (context: Partial<typeof globalThis>) => {
        delete context.window;
        delete context.document;
      };

      try {
        const [width, height] = win.getSize();
        // emulate jsdom using linkedom
        const window = new (await import('happy-dom')).Window({
          width,
          height,
          console,
        });
        const document = window.document;

        Object.assign(globalThis, {
          window,
          document,
        });

        const bgConfig: BgConfig = {
          fetch: getNetFetchAsFetch(),
          globalObj: globalThis,
          identifier: visitorData,
          requestKey,
        };

        const bgChallenge = await BG.Challenge.create(bgConfig);
        const interpreterJavascript =
          bgChallenge?.interpreterJavascript
            .privateDoNotAccessOrElseSafeScriptWrappedValue;

        if (interpreterJavascript) {
          // This is a workaround to run the interpreterJavascript code
          // Maybe there is a better way to do this (e.g. https://github.com/Siubaak/sval ?)
          // oxlint-disable-next-line typescript/no-implied-eval,typescript/no-unsafe-call
          new Function(interpreterJavascript)();

          const poTokenResult = await BG.PoToken.generate({
            program: bgChallenge.program,
            globalName: bgChallenge.globalName,
            bgConfig,
          }).finally(() => {
            cleanUp(globalThis);
          });

          yt.session.po_token = poTokenResult.poToken;
        } else {
          cleanUp(globalThis);
        }
      } catch {
        cleanUp(globalThis);
      }
    });
  }

  return yt;
};
