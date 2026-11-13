import { contextBridge, webFrame } from 'electron';

import { t } from '@/i18n';
import { config, type ConfigOf } from '@/plugins/utils/common/config';
import { createPlugin } from '@/utils';

import {
  isBlockerEnabled,
  loadTrackerBlockerEngine,
  unloadTrackerBlockerEngine,
} from './blocker';
import { inject, isInjected } from './injectors/inject';
import injectCliqzPreload from './injectors/inject-cliqz-preload';
import { blockers } from './types';

export const doNotTrackConfig = {
  /** When enabled, the tracker blocker will cache the blocklists. */
  cache: config.bool(true),
  /** Which tracker blocker to use. */
  blocker: config.select(
    blockers.InPlayer,
    [{ value: blockers.WithBlocklists }, { value: blockers.InPlayer }],
    { label: 'plugins.do-not-track.menu.blocker' },
  ),
  /**
   * Additional list of filters to use.
   * @example ["https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt"]
   */
  additionalBlockLists: config.list([]),
  /** Disable the default blocklists. */
  disableDefaultLists: config.bool(false),
};

export type TrackerBlockerConfig = ConfigOf<typeof doNotTrackConfig>;

// see #1478
const prunerScript = `const _prunerFn = window._pruner;
    window._pruner = undefined;
    JSON.parse = new Proxy(JSON.parse, {
      apply() {
        return _prunerFn(Reflect.apply(...arguments));
      },
    });
    Response.prototype.json = new Proxy(Response.prototype.json, {
      apply() {
        return Reflect.apply(...arguments).then((o) => _prunerFn(o));
      },
    }); 0`;

export default createPlugin({
  name: () => t('plugins.do-not-track.name'),
  description: () => t('plugins.do-not-track.description'),
  // The preload's injection into the page can't be undone.
  restartNeeded: true,
  config: doNotTrackConfig,
  async backend(ctx) {
    const { session } = ctx.window.webContents;

    // Load the blocklist engine when switching to it; it isn't restarted
    // for other changes.
    ctx.onConfigChange(async (newConfig) => {
      if (
        newConfig.blocker === blockers.WithBlocklists &&
        !isBlockerEnabled(session)
      ) {
        await loadTrackerBlockerEngine(
          session,
          newConfig.cache,
          newConfig.additionalBlockLists,
          newConfig.disableDefaultLists,
        );
      }
    });

    const config = ctx.config;
    if (config.blocker === blockers.WithBlocklists) {
      await loadTrackerBlockerEngine(
        session,
        config.cache,
        config.additionalBlockLists,
        config.disableDefaultLists,
      );
    }

    // Registered after the load: if the plugin stopped meanwhile, this runs at once.
    ctx.onCleanup(() => {
      if (isBlockerEnabled(session)) {
        unloadTrackerBlockerEngine(session);
      }
    });
  },
  async preload(ctx) {
    const injectInPlayer = async () => {
      if (isInjected()) return;
      inject(contextBridge);
      await webFrame.executeJavaScript(prunerScript);
    };

    // Nothing injected can be taken back, so a change never re-runs this
    // part; switching to the in-player blocker injects it if it isn't yet.
    ctx.onConfigChange(async (newConfig) => {
      if (newConfig.blocker === blockers.InPlayer) {
        await injectInPlayer();
      }
    });

    if (ctx.config.blocker === blockers.InPlayer) {
      await injectInPlayer();
    } else if (ctx.config.blocker === blockers.WithBlocklists) {
      await injectCliqzPreload();
    }
  },
});
