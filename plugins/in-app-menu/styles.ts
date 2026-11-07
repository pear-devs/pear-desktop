import { css } from "@pear/sdk/macros" with { type: "macro" };

// Light-DOM rules: pear-desktop's title bar sits above YTM, which moves down to make room
// (its layout scrolls instead of the page). From pear-desktop's titlebar.css.
export const pageStyles = css`
  :root {
    --titlebar-background-color: var(--ytmusic-color-black3);
    --menu-bar-height: 32px;
  }

  sel(app.layout) {
    overflow: auto scroll;
    height: calc(100vh - var(--menu-bar-height));
    /* fixes laggy list scrolling in large playlists */
    backface-visibility: hidden;
  }
  ytmusic-app-layout#layout {
    --ytmusic-nav-bar-offset: 0px;
  }
  ytmusic-app-layout > #content {
    padding-top: var(--menu-bar-height);
  }
  ytmusic-app-layout::-webkit-scrollbar {
    width: var(--ytmusic-scrollbar-width);
  }
  ytmusic-app-layout::-webkit-scrollbar-thumb {
    background-color: rgb(126, 126, 126);
  }

  ytmusic-app-layout > [slot="nav-bar"],
  sel(nav_bar.background).ytmusic-app-layout {
    top: var(--menu-bar-height) !important;
  }
  sel(nav_bar.divider).ytmusic-app-layout {
    top: calc(var(--ytmusic-nav-bar-height) + var(--menu-bar-height)) !important;
  }
  ytmusic-app[is-bauhaus-sidenav-enabled] #guide-spacer.ytmusic-app,
  ytmusic-app[is-bauhaus-sidenav-enabled] #mini-guide-spacer.ytmusic-app {
    margin-top: calc(var(--ytmusic-nav-bar-height) + var(--menu-bar-height)) !important;
  }
  @media (max-width: 935px) {
    ytmusic-app[is-bauhaus-sidenav-enabled] #guide-spacer.ytmusic-app {
      margin-top: var(--menu-bar-height) !important;
    }
    ytmusic-app[is-bauhaus-sidenav-enabled] #mini-guide-spacer.ytmusic-app {
      margin-top: calc(var(--ytmusic-nav-bar-height) + var(--menu-bar-height)) !important;
    }
  }

  ytmusic-app-layout > [slot="player-page"] {
    margin-top: var(--menu-bar-height);
    height: calc(100vh - var(--menu-bar-height) - var(--ytmusic-nav-bar-height) - var(--ytmusic-player-bar-height)) !important;
  }
  ytmusic-guide-renderer {
    height: calc(100vh - var(--menu-bar-height) - var(--ytmusic-nav-bar-height)) !important;
  }

  /* the mini player */
  ytmusic-app-layout ytmusic-player-page[is-mweb-modernization-enabled] .side-panel.ytmusic-player-page {
    transform: translate(
      0,
      calc(
        var(--ytmusic-player-page-inner-height) - var(--ytmusic-player-page-tabs-header-height) -
          var(--ytmusic-player-page-player-bar-height) - var(--menu-bar-height)
      )
    );
  }

  /* ytm-bugs: see https://github.com/pear-devs/pear-desktop/issues/1737 */
  html {
    scrollbar-color: unset;
  }
  /* fixes the scrollbar lagging behind in large playlists */
  ytmusic-browse-response .ytmusic-responsive-list-item-renderer {
    will-change: transform;
  }

  /* full screen: the player covers the bar, which slides away until the pointer reaches the top */
  sel(player.container)[player-ui-state="FULLSCREEN"] {
    margin-top: calc(var(--menu-bar-height) * -1) !important;
  }
  html:has(sel(player.container)[player-ui-state="FULLSCREEN"]) pear-title-bar:not([data-show]) {
    transform: translateY(calc(-1 * var(--menu-bar-height)));
  }
`;

// The bar and its panels, as pear-desktop drew them.
export const shadowStyles = css`
  :host {
    all: initial;
    position: fixed;
    top: 0;
    left: 0;
    z-index: 10000000;
    box-sizing: border-box;
    width: 100%;
    height: var(--menu-bar-height, 32px);
    display: flex;
    flex-flow: row;
    justify-content: flex-start;
    align-items: center;
    gap: 4px;
    padding: 4px;
    color: #f1f1f1;
    font: 12px Roboto, "Noto Naskh Arabic UI", Arial, sans-serif;
    background-color: var(--titlebar-background-color, #030303);
    user-select: none;
    transition:
      opacity 200ms ease 0s,
      transform 300ms cubic-bezier(0.2, 0, 0.6, 1) 0s,
      background-color 300ms cubic-bezier(0.2, 0, 0.6, 1) 0s;
  }
  :host([data-frameless]) {
    -webkit-app-region: drag;
  }
  :host([data-traffic-lights]) {
    padding-left: 74px;
  }
  :host([data-caption-buttons]) {
    padding-right: 138px;
  }
  * {
    box-sizing: border-box;
  }
  button {
    -webkit-app-region: no-drag;
    margin: 0;
    padding: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  svg {
    fill: currentColor;
  }
  :focus-visible {
    outline: 2px solid #c6e47a;
    outline-offset: -2px;
  }

  .icon-button {
    width: 24px;
    height: 24px;
    padding: 2px;
    border-radius: 2px;
    display: flex;
    justify-content: center;
    align-items: center;
    color: white;
    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .icon-button:hover {
    background: rgba(255, 255, 255, 0.1);
  }
  .icon-button:active {
    scale: 0.9;
  }
  .icon-button svg {
    width: 16px;
    height: 16px;
  }
  .toggle {
    border-top-left-radius: 4px;
  }

  .menus {
    display: flex;
    align-self: stretch;
    gap: 4px;
  }
  .menus[hidden] {
    display: none;
  }
  .menu-button {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 2px 8px;
    border-radius: 4px;
    white-space: nowrap;
    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    animation: menu-in 0.1s cubic-bezier(0.33, 1, 0.68, 1) calc(var(--index, 0) * 25ms) backwards;
  }
  .menu-button:hover {
    background-color: rgba(255, 255, 255, 0.1);
  }
  .menu-button:active {
    scale: 0.9;
  }
  .menu-button[aria-expanded="true"] {
    background-color: rgba(255, 255, 255, 0.2);
  }
  @keyframes menu-in {
    from {
      opacity: 0;
      transform: translateX(-50%) scale(0.8);
    }
  }

  .spacer {
    flex: 1;
  }
  .controls {
    display: flex;
    justify-content: flex-end;
    align-items: center;
  }
  .controls > :last-child {
    border-top-right-radius: 4px;
  }
  .controls > :last-child:hover {
    background: rgba(255, 0, 0, 0.5);
  }

  .panel {
    -webkit-app-region: no-drag;
    position: fixed;
    z-index: 10000;
    width: fit-content;
    max-width: calc(100vw - 16px);
    max-height: calc(100vh - 16px);
    padding: 4px;
    border-radius: 8px;
    overflow: auto;
    background-color: color-mix(in srgb, var(--titlebar-background-color, #030303) 50%, rgba(0, 0, 0, 0.1));
    backdrop-filter: blur(8px);
    box-shadow:
      0 0 0 1px rgba(0, 0, 0, 0.05),
      0 2px 8px rgba(0, 0, 0, 0.2);
    transform-origin: top left;
    animation: panel-in 0.225s cubic-bezier(0.33, 1, 0.68, 1);
  }
  @keyframes panel-in {
    from {
      opacity: 0;
      transform: scale(0.9);
    }
  }
  .item {
    position: relative;
    display: grid;
    grid-template-columns: 32px 1fr auto minmax(32px, auto);
    justify-content: flex-start;
    align-items: center;
    width: 100%;
    min-height: 32px;
    height: 32px;
    border-radius: 4px;
    color: white;
    text-align: left;
    white-space: nowrap;
    -webkit-user-drag: none;
    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .item:hover,
  .item:focus-visible {
    background-color: rgba(255, 255, 255, 0.1);
    outline: none;
  }
  .item:active,
  .item[aria-expanded="true"] {
    background-color: rgba(255, 255, 255, 0.2);
  }
  .item:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .item svg {
    width: 32px;
    height: 32px;
    padding: 4px;
  }
  .item svg.stroke {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .item svg.radio {
    padding: 6px;
  }
  .item .label {
    padding-right: 8px;
  }
  .item .chip {
    display: flex;
    justify-content: center;
    align-items: center;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    margin-left: 8px;
    border-radius: 4px;
    background-color: rgba(255, 255, 255, 0.2);
    color: #f1f1f1;
    font-size: 10px;
    font-weight: 500;
    line-height: 1;
  }
  .item kbd {
    justify-self: end;
    padding: 0 8px;
    color: #8f8f8f;
    font: inherit;
  }
  .separator {
    min-height: 1px;
    height: 1px;
    margin: 4px 0;
    background-color: rgba(255, 255, 255, 0.2);
  }
`;
