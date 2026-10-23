/** @jsxImportSource @pear/sdk */
import { definePlugin } from "@pear/sdk";
import { Icon } from "@pear/sdk/dom";
import { css } from "@pear/sdk/macros" with { type: "macro" };

const CHEVRON_LEFT = "M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z";
const CHEVRON_RIGHT = "M8.59 16.59 10 18l6-6-6-6-1.41 1.41L13.17 12z";

// Chromium's Navigation API (not yet in TypeScript's DOM lib).
interface NavigationApi extends EventTarget {
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
}

export default definePlugin({
  id: "navigation",
  name: "Navigation buttons",
  description: "Back and forward buttons in the top bar.",
  enabledByDefault: true,
  style: css`
    .pear-navigation {
      display: flex;
      align-items: center;
      gap: 2px;
      margin-left: 12px;
    }
    .pear-navigation button {
      display: grid;
      place-items: center;
      width: 36px;
      height: 36px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: none;
      color: var(--ytmusic-text-primary, #fff);
      cursor: pointer;
      transition: background-color 120ms, opacity 120ms;
    }
    .pear-navigation button:hover:not(:disabled) {
      background: rgb(255 255 255 / 0.1);
    }
    .pear-navigation button:active:not(:disabled) {
      background: rgb(255 255 255 / 0.2);
    }
    .pear-navigation button:disabled {
      opacity: 0.35;
      cursor: default;
    }
    .pear-navigation svg {
      width: 28px;
      height: 28px;
      fill: currentColor;
    }
  `,
  page: (ctx) => {
    // pear-desktop's texts and translations.
    const back = navButton(ctx.t("plugins.navigation.templates.back.title", "Go to previous page"), CHEVRON_LEFT, () => history.back());
    const forward = navButton(ctx.t("plugins.navigation.templates.forward.title", "Go to next page"), CHEVRON_RIGHT, () => history.forward());
    const container = (
      <div class="pear-navigation">
        {back}
        {forward}
      </div>
    );

    const navigation = (window as { navigation?: NavigationApi }).navigation;
    const update = () => {
      if (!navigation) return;
      back.disabled = !navigation.canGoBack;
      forward.disabled = !navigation.canGoForward;
    };
    update();
    if (navigation) ctx.listen(navigation, "currententrychange", update);

    // YTM re-renders the nav bar on some navigations.
    ctx.mount(container, "nav_bar.left", "append");
  },
});

function navButton(label: string, path: string, onClick: () => void) {
  const button = (
    <button type="button" title={label} aria-label={label} onClick={onClick}>
      <Icon path={path} />
    </button>
  );
  return button as HTMLButtonElement;
}
