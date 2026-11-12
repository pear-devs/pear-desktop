// The player bar in either of YTM's layouts (see @pear/sdk/selectors): the
// classic one, or the new one YTM gives some visitors, picked per profile.

import { selectors, type SelectorName } from "@pear/sdk/selectors";
import type { Page } from "@playwright/test";

/** A registry selector; the player bar's match either layout. */
export const sel = (name: SelectorName): string => selectors[name];

/** `css` inside the player bar, whichever layout YTM picked. */
export const inBar = (css: string) => `:is(${selectors.player_bar}) ${css}`;

/** Which player bar the page shows. */
export const barLayout = (page: Page) =>
  page.evaluate((newBar) => (document.querySelector(newBar) ? "new" : "classic"), selectors["player_bar.new"]);

/** Makes YTM show a like status on the player bar, as it does after a click on its buttons. */
export async function showLikeStatus(page: Page, status: "LIKE" | "DISLIKE") {
  await page.evaluate(
    ([status, classic, like, dislike]) => {
      const buttons = document.querySelector(classic);
      if (buttons?.hasAttribute("like-status")) return buttons.setAttribute("like-status", status);
      document.querySelector(status === "LIKE" ? like : dislike)?.setAttribute("aria-pressed", "true");
    },
    [status, selectors["player_bar.like_buttons"], selectors["player_bar.like"], selectors["player_bar.dislike"]] as const,
  );
}
