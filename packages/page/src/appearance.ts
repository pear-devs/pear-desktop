// The core's appearance options that act on YTM's page (the Upgrade
// button, like buttons). All of it applies live: each tweak is a style sheet
// that comes and goes with its option. Theme files: @pear/sdk/stylesheets.

import type { CoreState } from "@pear/sdk/protocol";
import { css } from "@pear/sdk/macros" with { type: "macro" };
import { selectors } from "@pear/sdk/selectors";
import { adoptSheet, dropSheets, styleSheet } from "@pear/sdk/stylesheets";
import { waitForSelector } from "./dom.ts";

const STYLES = {
  removeUpgradeButton: css`sel(upgrade.button) { display: none !important; }`,
  // YTM hides the likes in narrow windows; "force" keeps them, "hide" always hides them.
  forceLikeButtons: css`sel(player_bar.middle_buttons), sel(player_bar.like_buttons) { display: inherit !important; }`,
  hideLikeButtons: css`sel(player_bar.like_buttons) { display: none !important; }`,
  // As specific as YTM's own display rule, so its narrow-window rule still wins.
  // The new player bar's pair is one pill: its rounded ends and divider swap too.
  swapLikeButtonsOrder: css`
    sel(like_buttons):where(sel(player_bar.like_buttons)) { display: inline-flex; flex-direction: row-reverse; }
    sel(player_bar.like_pair) { flex-direction: row-reverse; }
    sel(player_bar.like_pair) like-button-view-model button { border-radius: 0 16px 16px 0 !important; }
    sel(player_bar.like_pair) dislike-button-view-model button { border-radius: 16px 0 0 16px !important; }
    sel(player_bar.like_pair) like-button-view-model button::after { left: 0 !important; right: auto !important; }
  `,
};

type Tweak = keyof typeof STYLES;

interface GuideEntry extends HTMLElement {
  data?: { navigationEndpoint?: { browseEndpoint?: { browseId?: string } }; icon?: { iconType?: string } };
}

// YTM's Premium promotion: its browse page, shown with the app's own logo.
const UPGRADE_BROWSE_ID = "SPunlimited";
const UPGRADE_ICON = "\u0059\u004f\u0055\u0054\u0055\u0042\u0045_MUSIC_MONOCHROME";

function isUpgradeEntry({ data }: GuideEntry) {
  const opensUpgradePage = data?.navigationEndpoint?.browseEndpoint?.browseId === UPGRADE_BROWSE_ID;
  return opensUpgradePage || data?.icon?.iconType === UPGRADE_ICON;
}

export class Appearance {
  #sheets = new Map<Tweak, CSSStyleSheet>();
  #upgradeObserver: MutationObserver | undefined;
  #upgradeWait: AbortController | undefined;

  apply({ config }: CoreState) {
    const likes = config.likeButtons;
    this.#toggle("removeUpgradeButton", config.removeUpgradeButton === true);
    this.#toggle("forceLikeButtons", likes === "force");
    this.#toggle("hideLikeButtons", likes === "hide");
    this.#toggle("swapLikeButtonsOrder", config.swapLikeButtonsOrder === true);
    if (config.removeUpgradeButton === true) this.#markUpgradeEntries();
    else this.#stopMarking();
  }

  #toggle(tweak: Tweak, on: boolean) {
    const sheet = this.#sheets.get(tweak);
    if (on && !sheet) {
      const added = styleSheet(STYLES[tweak]);
      this.#sheets.set(tweak, added);
      // Before the themes, so a theme can still restyle what a tweak shows.
      adoptSheet(added);
    } else if (!on && sheet) {
      this.#sheets.delete(tweak);
      dropSheets([sheet]);
    }
  }

  /** The Upgrade entry only differs by its data, so it is marked for the style sheet. */
  #markUpgradeEntries() {
    if (this.#upgradeObserver) return;
    const mark = () => {
      for (const entry of document.querySelectorAll<GuideEntry>(selectors["guide.entry"])) {
        entry.toggleAttribute("pear-upgrade", isUpgradeEntry(entry));
      }
    };
    // Entries are re-rendered in place (new data, new children) when the guide updates.
    const observer = new MutationObserver(mark);
    const wait = new AbortController();
    this.#upgradeObserver = observer;
    this.#upgradeWait = wait;
    for (const name of ["guide.full", "guide.mini"] as const) {
      waitForSelector(selectors[name], { signal: wait.signal }).then(
        (guide) => {
          observer.observe(guide, { childList: true, subtree: true, characterData: true });
          mark();
        },
        () => {},
      );
    }
  }

  #stopMarking() {
    this.#upgradeWait?.abort();
    this.#upgradeObserver?.disconnect();
    this.#upgradeObserver = undefined;
  }
}
