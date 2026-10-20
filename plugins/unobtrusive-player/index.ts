import { definePlugin } from "@pear/sdk";
import { css } from "@pear/sdk/macros" with { type: "macro" };

// Set while playback was started from a list: the player page stays out of the way.
const DID_PLAY = "pear-unobtrusive-did-play";
// YTM can't close the player page during an ad, and the ad should be seen anyway.
const AD = "pear-unobtrusive-ad";
const AUTO_CLOSING_MS = 500;

export default definePlugin({
  id: "unobtrusive-player",
  name: "Unobtrusive player",
  description: "Starting a song from a list keeps you where you are instead of opening the full player.",
  style: css`
    html.pear-unobtrusive-did-play:not(.pear-unobtrusive-ad) sel(player.page),
    html.pear-unobtrusive-did-play:not(.pear-unobtrusive-ad) sel(player.page) * {
      visibility: hidden !important;
    }
    html.pear-unobtrusive-did-play sel(player_bar.player_page_arrow) {
      transform: rotate(180deg) !important;
    }
  `,
  page: (ctx) => {
    const root = document.documentElement;
    ctx.onCleanup(() => root.classList.remove(DID_PLAY, AD));
    let autoClosing = false;

    ctx.listen(
      document,
      "click",
      (event: MouseEvent) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (target.closest(ctx.sel("player_bar"))) {
          // The user is driving the player now (e.g. opening the page); stop hiding it.
          if (!autoClosing) root.classList.remove(DID_PLAY);
          return;
        }
        if (target.closest(ctx.sel("player.page"))) return;
        // Play buttons, track links and "Shuffle"/"Start radio" style menu entries all lead to /watch.
        if (target.closest(`${ctx.sel("list.play_button")}, a[href*="watch?"]`)) root.classList.add(DID_PLAY);
      },
      { capture: true },
    );

    const closePlayerPage = () => {
      if (autoClosing || !root.classList.contains(DID_PLAY)) return;
      if (ctx.$("app.layout")?.getAttribute("player-ui-state") !== "PLAYER_PAGE_OPEN") return;
      autoClosing = true;
      ctx.$("player_bar.toggle_player_page")?.click();
      // Keep the page hidden until YTM's close animation is over, then check
      // again: YTM ignores the toggle while it is still opening the page.
      ctx.setTimeout(() => {
        autoClosing = false;
        closePlayerPage();
      }, AUTO_CLOSING_MS);
    };
    // YTM opens the page either while navigating to /watch or once the track loads.
    ctx.player.on("trackLoading", closePlayerPage);
    const onAd = (ad: boolean) => {
      root.classList.toggle(AD, ad);
      if (!ad) closePlayerPage();
    };
    ctx.player.on("adChange", onAd);
    onAd(ctx.player.state.ad);
    ctx.observe("app.layout", { attributes: true, attributeFilter: ["player-ui-state"] }, closePlayerPage);
  },
});
