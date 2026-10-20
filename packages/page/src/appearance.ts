// The core's appearance options that act on YTM's page (the Upgrade
// button, like buttons) and the user's theme files. All of it applies live:
// each tweak is a style sheet that comes and goes with its option.

import type { CoreState } from "@pear/sdk/protocol";
import { css } from "@pear/sdk/macros" with { type: "macro" };
import { selectors } from "@pear/sdk/selectors";
import { waitForSelector } from "./dom.ts";

const STYLES = {
  removeUpgradeButton: css`sel(upgrade.button) { display: none !important; }`,
  // YTM hides the likes in narrow windows; "force" keeps them, "hide" always hides them.
  forceLikeButtons: css`sel(player_bar.middle_buttons), sel(player_bar.like_buttons) { display: inherit !important; }`,
  hideLikeButtons: css`sel(player_bar.like_buttons) { display: none !important; }`,
  // As specific as YTM's own display rule, so its narrow-window rule still wins.
  swapLikeButtonsOrder: css`sel(like_buttons):where(sel(player_bar.like_buttons)) { display: inline-flex; flex-direction: row-reverse; }`,
};

type Tweak = keyof typeof STYLES;

interface GuideEntry extends HTMLElement {
  data?: { navigationEndpoint?: { browseEndpoint?: { browseId?: string } }; icon?: { iconType?: string } };
}

/** YTM's Premium promotion: its browse page, shown with the app's own logo. */
function isUpgradeEntry({ data }: GuideEntry) {
  return data?.navigationEndpoint?.browseEndpoint?.browseId === "SPunlimited" || data?.icon?.iconType === "\u0059\u004f\u0055\u0054\u0055\u0042\u0045_MUSIC_MONOCHROME";
}

export class Appearance {
  #sheets = new Map<Tweak, CSSStyleSheet>();
  #themes: CSSStyleSheet[] = [];
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

  /** Replaces the theme sheets; they come after everything else, so themes win ties. */
  setThemes(css: readonly string[]) {
    const old = new Set(this.#themes);
    this.#themes = css.map((text) => {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(text);
      return sheet;
    });
    document.adoptedStyleSheets = [...document.adoptedStyleSheets.filter((sheet) => !old.has(sheet)), ...this.#themes];
  }

  #toggle(tweak: Tweak, on: boolean) {
    const sheet = this.#sheets.get(tweak);
    if (on && !sheet) {
      const added = new CSSStyleSheet();
      added.replaceSync(STYLES[tweak]);
      this.#sheets.set(tweak, added);
      // Before the themes, so a theme can still restyle what a tweak shows.
      const others = document.adoptedStyleSheets.filter((s) => !this.#themes.includes(s));
      document.adoptedStyleSheets = [...others, added, ...this.#themes];
    } else if (!on && sheet) {
      this.#sheets.delete(tweak);
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet);
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
    const observer = (this.#upgradeObserver = new MutationObserver(mark));
    const wait = (this.#upgradeWait = new AbortController());
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
