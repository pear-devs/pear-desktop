// YTM's feature flags ("experiments"): the page's inline config script hands
// them to `ytcfg.set({ EXPERIMENT_FLAGS })`, and YTM's code reads them from
// `yt.config_` afterwards. The runtime runs before that script, so it wraps
// `ytcfg.set` as soon as the page defines `ytcfg`, and the user's overrides
// land in the flags before anything reads them.
//
// Only flags YTM's own code reads change anything; the server decides the rest.

import { type ConfigOf, normalizeConfig } from "@pear/sdk";
import { type Flags, flagOverrides, SITE } from "@pear/sdk/core-config";

type SiteConfig = ConfigOf<typeof SITE>;

/**
 * The flags behind the "Player bar" setting. YTM hands them out together:
 * without the action bar flag the new bar has no like buttons.
 */
const NEW_PLAYER_BAR = [
  "music_web_enable_wiz_miniplayer",
  "music_web_enable_action_bar_view_model_in_player_overlay",
  "music_web_enable_like_count_in_player_overlay",
  "music_web_enable_contained_content_layout",
];
const allSetTo = (value: boolean): Flags => Object.fromEntries(NEW_PLAYER_BAR.map((name) => [name, value]));

const PLAYER_BAR_FLAGS: Record<Exclude<SiteConfig["playerBar"], "">, Flags> = {
  classic: allSetTo(false),
  new: allSetTo(true),
};

/** The overrides the settings (the core "site" section) ask for; the list wins over the named settings. */
export function siteOverrides(stored: Record<string, unknown>): Flags {
  const config: SiteConfig = normalizeConfig(SITE, stored);
  const named = config.playerBar ? PLAYER_BAR_FLAGS[config.playerBar] : {};
  return { ...named, ...flagOverrides(config.siteFlags) };
}

interface Ytcfg {
  set(...args: unknown[]): unknown;
}

export interface SiteFlags {
  /** The flags as YTM served them, before the overrides (empty until it has). */
  readonly served: Flags;
  readonly overrides: Flags;
}

/** Applies `overrides` to the flags YTM's page sets up; call before its scripts run. */
export function overrideSiteFlags(overrides: Flags): SiteFlags {
  const served: Flags = {};
  const apply = (flags: Flags) => {
    for (const [name, value] of Object.entries(flags)) if (!(name in served)) served[name] = value;
    Object.assign(flags, overrides);
  };
  const wrap = (ytcfg: Ytcfg) => {
    const set = ytcfg.set;
    ytcfg.set = function (this: unknown, ...args: unknown[]) {
      if (args.length > 1 && args[0] === "EXPERIMENT_FLAGS") apply(args[1] as Flags);
      else if (isRecord(args[0]) && isRecord(args[0].EXPERIMENT_FLAGS)) apply(args[0].EXPERIMENT_FLAGS as Flags);
      return set.apply(this, args);
    };
  };

  const page = window as unknown as { ytcfg?: Ytcfg; yt?: { config_?: { EXPERIMENT_FLAGS?: Flags } } };
  if (page.ytcfg) {
    // Too late to catch the first set (not expected: the runtime runs first); patch what is there.
    const current = page.yt?.config_?.EXPERIMENT_FLAGS;
    if (current) apply(current);
    wrap(page.ytcfg);
  } else {
    // The page's `var ytcfg = {…}` assigns through this accessor instead of replacing it.
    let ytcfg: Ytcfg | undefined;
    Object.defineProperty(window, "ytcfg", {
      configurable: true,
      enumerable: true,
      get: () => ytcfg,
      set(value: Ytcfg) {
        ytcfg = value;
        if (value && typeof value.set === "function") wrap(value);
      },
    });
  }
  return { served, overrides };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
