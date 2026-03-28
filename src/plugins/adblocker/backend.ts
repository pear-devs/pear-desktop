import { readFile, writeFile } from 'node:fs/promises';

import { join } from 'node:path';

import { app, session } from 'electron';
import { ElectronBlocker } from '@ghostery/adblocker-electron';
import is from 'electron-is';

import { LoggerPrefix } from '@/utils';

import type { BackendContext } from '@/types/contexts';

import type { AdblockerPluginConfig } from './config';

let activeBlocker: ElectronBlocker | null = null;

async function loadBlockerEngine(
  cfg: AdblockerPluginConfig,
): Promise<ElectronBlocker> {
  const fetchImpl = globalThis.fetch.bind(globalThis);

  const caching = cfg.cache
    ? {
        path: join(app.getPath('userData'), 'adblocker-engine.bin'),
        read: async (p: string) => new Uint8Array(await readFile(p)),
        write: async (p: string, buf: Uint8Array) => {
          await writeFile(p, Buffer.from(buf));
        },
      }
    : undefined;

  let engine = await ElectronBlocker.fromPrebuiltAdsAndTracking(
    fetchImpl,
    caching,
  );

  const lists = (cfg.additionalBlockLists ?? []).filter(
    (u): u is string => typeof u === 'string' && u.length > 0,
  );
  if (lists.length > 0) {
    const extra = await ElectronBlocker.fromLists(fetchImpl, lists);
    engine = ElectronBlocker.merge([engine, extra]);
  }

  // Do not block first-party YTM player telemetry/API; blocking breaks playback or desyncs A/V for some users.
  const ytMusicPlaybackAllow = await ElectronBlocker.parse(
    [
      '@@||music.youtube.com/youtubei/^',
      '@@||music.youtube.com/api/stats/^',
      '@@||music.youtube.com/ptracking^',
      '@@||music.youtube.com/generate_204^',
      '@@||play.google.com/log^',
      '@@||www.youtube.com/pagead/^$domain=music.youtube.com',
    ].join('\n'),
  );
  engine = ElectronBlocker.merge([engine, ytMusicPlaybackAllow]);

  return engine;
}

export function stopBlocker() {
  if (!activeBlocker) return;
  try {
    activeBlocker.disableBlockingInSession(session.defaultSession);
  } catch {
    /* session may already be torn down */
  }
  activeBlocker = null;
}

export async function startBlocker(cfg: AdblockerPluginConfig) {
  if (!cfg.enabled) return;
  try {
    const engine = await loadBlockerEngine(cfg);
    activeBlocker = engine;
    engine.enableBlockingInSession(session.defaultSession);
    if (is.dev()) {
      console.log(LoggerPrefix, 'Adblocker: network blocking enabled');
    }
  } catch (err) {
    console.error(LoggerPrefix, 'Adblocker: failed to start', err);
  }
}

export async function startFromContext(
  ctx: BackendContext<AdblockerPluginConfig>,
) {
  await startBlocker(await ctx.getConfig());
}
