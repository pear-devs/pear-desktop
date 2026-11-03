import { css } from "@pear/sdk/macros" with { type: "macro" };

// Light-DOM rules: the top bar doubles as the window's title bar.
export const pageStyles = css`
  html.pear-frameless sel(nav_bar),
  html.pear-frameless sel(nav_bar.left),
  html.pear-frameless sel(nav_bar.center),
  html.pear-frameless sel(nav_bar.right) {
    -webkit-app-region: drag;
  }
  html.pear-frameless sel(nav_bar.left) > *,
  html.pear-frameless sel(nav_bar.center) > *,
  html.pear-frameless sel(nav_bar.right) > *,
  pear-app-menu,
  pear-window-controls {
    -webkit-app-region: no-drag;
  }
  html.pear-traffic-lights sel(nav_bar.left) {
    padding-left: 72px;
  }
  html.pear-caption-buttons sel(nav_bar.right) {
    padding-right: 138px;
  }
`;

export const shadowStyles = css`
  :host {
    all: initial;
    display: flex;
    align-items: center;
    align-self: center;
    font: 13px/1.4 "\u0059\u006f\u0075\u0054\u0075\u0062\u0065 Sans", Roboto, "Segoe UI", system-ui, sans-serif;
    color: #f1f1f1;
  }
  button {
    display: grid;
    place-items: center;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  svg {
    width: 20px;
    height: 20px;
    fill: currentColor;
  }
  :focus-visible {
    outline: 2px solid #c6e47a;
    outline-offset: -2px;
  }

  .trigger {
    width: 40px;
    height: 40px;
    margin-right: 4px;
    border-radius: 50%;
  }
  .trigger:hover,
  .trigger[aria-expanded="true"] {
    background: rgb(255 255 255 / 0.1);
  }
  .trigger svg {
    width: 24px;
    height: 24px;
  }

  .panel {
    position: fixed;
    z-index: 2147483000;
    min-width: 260px;
    padding: 6px;
    background: #212121;
    border: 1px solid rgb(255 255 255 / 0.08);
    border-radius: 12px;
    box-shadow: 0 12px 40px rgb(0 0 0 / 0.55);
    animation: open 110ms cubic-bezier(0.2, 0.8, 0.2, 1);
    transform-origin: top left;
  }
  .panel[hidden] {
    display: none;
  }
  @keyframes open {
    from {
      opacity: 0;
      transform: scale(0.96) translateY(-4px);
    }
  }
  .item {
    display: grid;
    grid-template-columns: 20px 1fr auto;
    place-items: center start;
    gap: 12px;
    width: 100%;
    height: 34px;
    padding: 0 10px;
    border-radius: 8px;
    text-align: left;
  }
  .item:hover,
  .item:focus-visible {
    background: rgb(255 255 255 / 0.1);
    outline: none;
  }
  .item > svg:first-child {
    width: 16px;
    height: 16px;
    color: #c6e47a;
    visibility: hidden;
  }
  .item[aria-checked="true"] > svg:first-child {
    visibility: visible;
  }
  .item:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .item[aria-expanded="true"] {
    background: rgb(255 255 255 / 0.1);
  }
  .item .label {
    display: flex;
    flex-direction: column;
    min-width: 0;
    white-space: nowrap;
  }
  .item .label small {
    color: #8f8f8f;
    font-size: 11px;
  }
  .item > svg:last-child {
    justify-self: end;
    width: 18px;
    height: 18px;
    color: #8f8f8f;
  }
  .item kbd {
    justify-self: end;
    color: #8f8f8f;
    font: inherit;
    font-size: 12px;
  }
  .separator {
    height: 1px;
    margin: 6px 4px;
    background: rgb(255 255 255 / 0.1);
  }

  .controls {
    display: flex;
    height: 40px;
    margin-left: 8px;
  }
  .controls button {
    width: 44px;
    height: 40px;
    border-radius: 8px;
    color: #c8c8c8;
  }
  .controls button:hover {
    background: rgb(255 255 255 / 0.1);
    color: #fff;
  }
  .controls button.close:hover {
    background: #c42b1c;
  }
  .controls svg {
    width: 16px;
    height: 16px;
  }
`;
