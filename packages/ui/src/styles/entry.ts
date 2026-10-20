import { css } from "@pear/sdk/macros" with { type: "macro" };

/** The "Settings" entry in YTM's sidebar (full and mini guide), in YTM's own look. */
export const entry = css`
  :host { display: block; }
  button {
    display: flex;
    align-items: center;
    gap: 20px;
    width: 100%;
    height: 48px;
    margin: 0;
    padding: 0 14px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: #fff;
    font: 16px Roboto, system-ui, sans-serif;
    text-align: left;
    cursor: pointer;
    user-select: none;
  }
  button:hover { background: rgb(255 255 255 / 0.1); }
  button:focus-visible { outline: 2px solid var(--primary); }
  :host([mini]) button {
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    width: 100%;
    height: 64px;
    margin: 0;
    padding: 0;
    font-size: 10px;
  }
`;
