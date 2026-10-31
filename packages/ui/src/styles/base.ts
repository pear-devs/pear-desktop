import { css } from "@pear/sdk/macros" with { type: "macro" };

/** The overlay's host, resets, and the rules many components share. */
export const base = css`
  :host {
    all: initial;
    font: 14px/1.45 Roboto, "Segoe UI", system-ui, sans-serif;
    color: var(--on-surface);
  }
  *, *::before, *::after { box-sizing: border-box; }
  button, input, select { font: inherit; color: inherit; }
  :focus-visible, .search:focus-within { outline: 2px solid var(--primary); outline-offset: 2px; }

  @keyframes scrim-in { from { opacity: 0; } to { opacity: 1; } }
  @keyframes pop-in { from { opacity: 0; transform: translateY(8px) scale(0.98); } to { opacity: 1; transform: none; } }

  /* buttons without a frame, and outlined ones */
  .nav-item, .link, .icon-button, .plugin-toggle, .restart-later, .restart-now {
    border: 0;
    background: none;
    cursor: pointer;
  }
  .outlined, .chip, .stepper-button {
    border: 1px solid var(--outline);
    background: transparent;
    cursor: pointer;
  }
  .icon-button:hover, .outlined:hover, .chip:hover, .stepper-button:hover { background: var(--surface-highest); }

  /* text inputs and dropdowns */
  .dropdown, .text, .stepper-input {
    border: 1px solid var(--outline);
    border-radius: 8px;
    outline: none;
    background: var(--surface-high);
    color: var(--on-surface);
    font-size: 14px;
  }
  .text:focus, .stepper-input:focus { border-color: var(--primary); }
`;

export const scrollbars = css`
  .nav::-webkit-scrollbar, .body::-webkit-scrollbar { width: 10px; }
  .nav::-webkit-scrollbar-thumb, .body::-webkit-scrollbar-thumb {
    border: 2px solid transparent;
    border-radius: 8px;
    background: rgb(255 255 255 / 0.16);
    background-clip: padding-box;
  }

  @media (max-width: 640px) {
    .sidebar { width: 200px; }
  }
`;
