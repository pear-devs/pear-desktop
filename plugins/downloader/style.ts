// In its own module: inside index.ts, unplugin-macros left this css`` call unexpanded.
import { css } from "@pear/sdk/macros" with { type: "macro" };

export const style = css`
  .pear-dl {
    position: relative;
    display: inline-flex;
  }
  .pear-dl-button {
    --pear-dl-progress: 0;
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    margin: 0 4px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: none;
    color: var(--ytmusic-text-secondary, #aaa);
    cursor: pointer;
  }
  .pear-dl-button:hover,
  .pear-dl-button:focus-visible,
  .pear-dl-button[aria-expanded="true"] {
    color: var(--ytmusic-text-primary, #fff);
    background: rgb(255 255 255 / 0.1);
    outline: none;
  }
  .pear-dl-button[data-busy]::before {
    content: "";
    position: absolute;
    inset: 3px;
    border-radius: 50%;
    background: conic-gradient(#fff calc(var(--pear-dl-progress) * 1turn), rgb(255 255 255 / 0.15) 0);
    mask: radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 2px));
  }
  .pear-dl-button[data-busy="converting"]::before {
    animation: pear-dl-pulse 1s ease-in-out infinite alternate;
  }
  .pear-dl-button svg {
    position: relative;
  }
  @keyframes pear-dl-pulse {
    from {
      opacity: 1;
    }
    to {
      opacity: 0.35;
    }
  }
  .pear-dl-menu {
    position: absolute;
    bottom: calc(100% + 8px);
    right: 0;
    z-index: 10;
    min-width: 200px;
    padding: 8px 0;
    border-radius: 8px;
    background: var(--ytmusic-menu-background, #212121);
    box-shadow: 0 4px 16px rgb(0 0 0 / 0.5);
  }
  .pear-dl-menu[hidden] {
    display: none;
  }
  .pear-dl-menu button {
    display: block;
    width: 100%;
    padding: 10px 16px;
    border: 0;
    background: none;
    color: var(--ytmusic-text-primary, #fff);
    font: 400 14px Roboto, "Noto Naskh Arabic UI", Arial, sans-serif;
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
  }
  .pear-dl-menu button:hover,
  .pear-dl-menu button:focus-visible {
    background: rgb(255 255 255 / 0.1);
    outline: none;
  }
  .pear-dl-toast {
    position: fixed;
    left: 50%;
    bottom: calc(var(--ytmusic-player-bar-height, 72px) + 16px);
    z-index: 1000;
    display: flex;
    align-items: center;
    gap: 16px;
    max-width: min(560px, 90vw);
    padding: 12px 16px;
    border-radius: 6px;
    background: #f1f1f1;
    color: #0f0f0f;
    font: 400 14px Roboto, Arial, sans-serif;
    box-shadow: 0 4px 16px rgb(0 0 0 / 0.4);
    transform: translate(-50%, 0);
    transition:
      opacity 0.2s,
      transform 0.2s;
  }
  .pear-dl-toast[hidden] {
    display: flex;
    opacity: 0;
    pointer-events: none;
    transform: translate(-50%, 12px);
  }
  .pear-dl-toast span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pear-dl-toast button {
    flex: none;
    padding: 0;
    border: 0;
    background: none;
    color: #065fd4;
    font: 500 14px Roboto, Arial, sans-serif;
    cursor: pointer;
  }
  /* pear-desktop's "Download" entry in YTM's track, album and playlist menus. */
  .pear-dl-item {
    display: flex;
    align-items: center;
    gap: 16px;
    height: 48px;
    padding: 0 16px;
    color: var(--ytmusic-text-primary, #fff);
    font: 400 14px Roboto, "Noto Naskh Arabic UI", Arial, sans-serif;
    cursor: pointer;
  }
  .pear-dl-item:hover,
  .pear-dl-item:focus-visible {
    background: rgb(255 255 255 / 0.1);
    outline: none;
  }
  .pear-dl-item svg {
    width: 24px;
    height: 24px;
    color: rgb(255 255 255 / 0.7);
  }
`;
