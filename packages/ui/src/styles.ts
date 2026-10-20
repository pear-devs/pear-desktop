import { css } from "@pear/sdk/macros" with { type: "macro" };

// Shadow-DOM styles for the settings dialog (Material 3, dark), validated and
// minified at build time. Used by the in-page overlay and the standalone window.
export const overlayStyles = css`
  :host {
    all: initial;
    --primary: #d0bcff;
    --on-primary: #381e72;
    --on-surface: #e6e1e5;
    --on-surface-variant: #cac4d0;
    --surface-low: #1d1b20;
    --surface: #211f26;
    --surface-high: #2b2930;
    --surface-highest: #36343b;
    --secondary-container: #4a4458;
    --on-secondary-container: #e8def8;
    --tertiary-container: #633b48;
    --on-tertiary-container: #ffd8e4;
    --outline: #938f99;
    --edge: #49454f;
    --error: #f2b8b5;
    font: 14px/1.45 Roboto, "Segoe UI", system-ui, sans-serif;
    color: var(--on-surface);
  }
  *, *::before, *::after { box-sizing: border-box; }
  button, input, select { font: inherit; color: inherit; }
  :focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }

  @keyframes scrim-in { from { opacity: 0; } to { opacity: 1; } }
  @keyframes pop-in { from { opacity: 0; transform: translateY(8px) scale(0.98); } to { opacity: 1; transform: none; } }

  .root {
    position: fixed;
    inset: 0;
    z-index: 2147483000;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgb(0 0 0 / 0.62);
    backdrop-filter: blur(3px);
    animation: scrim-in 0.18s ease both;
  }
  .dialog {
    position: relative;
    width: 880px;
    max-width: calc(100vw - 40px);
    height: 592px;
    max-height: calc(100vh - 40px);
    display: flex;
    background: var(--surface-low);
    border-radius: 28px;
    overflow: hidden;
    box-shadow: 0 24px 64px rgb(0 0 0 / 0.55), 0 4px 12px rgb(0 0 0 / 0.4);
    animation: pop-in 0.22s cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  .root[data-standalone="true"] { background: var(--surface-low); backdrop-filter: none; animation: none; }
  .root[data-standalone="true"] .dialog {
    width: 100%;
    max-width: none;
    height: 100%;
    max-height: none;
    border-radius: 0;
    box-shadow: none;
    animation: none;
  }

  /* sidebar */
  .sidebar {
    width: 244px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border-right: 1px solid var(--edge);
  }
  .sidebar-head { padding: 22px 20px 14px; }
  .sidebar-title { font-size: 22px; line-height: 28px; }
  .sidebar-subtitle {
    display: flex;
    align-items: center;
    gap: 5px;
    margin-top: 3px;
    font-size: 12px;
    color: var(--on-surface-variant);
  }
  .search {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 48px;
    margin: 0 14px 10px;
    padding: 0 16px;
    border-radius: 24px;
    background: var(--surface-high);
    color: var(--on-surface-variant);
  }
  .search:focus-within { outline: 2px solid var(--primary); outline-offset: 2px; }
  .search input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: none;
    background: transparent;
    font-size: 15px;
    color: var(--on-surface);
  }
  .search input::-webkit-search-cancel-button { filter: invert(0.8); }
  .nav {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 4px 12px 14px;
    overflow-y: auto;
  }
  .nav-item {
    display: flex;
    align-items: center;
    gap: 14px;
    width: 100%;
    height: 42px;
    padding: 0 16px;
    border: 0;
    border-radius: 21px;
    background: transparent;
    color: var(--on-surface-variant);
    font-size: 14px;
    font-weight: 500;
    text-align: left;
    cursor: pointer;
  }
  .nav-item:hover { background: var(--surface-high); }
  .nav-item[aria-current="page"] { background: var(--secondary-container); color: var(--on-secondary-container); }
  .nav-label { flex: 1; }
  .nav-count { font-size: 11px; opacity: 0.8; }
  .sidebar-foot {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 20px;
    border-top: 1px solid var(--edge);
    font-size: 11px;
    color: var(--on-surface-variant);
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--primary);
    font-size: 11px;
    cursor: pointer;
  }
  .link:hover { text-decoration: underline; }

  /* main */
  .main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .header {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 12px;
    height: 60px;
    padding: 0 12px 0 28px;
    border-bottom: 1px solid var(--edge);
  }
  .header-text { flex: 1; min-width: 0; }
  .header-title { font-size: 16px; font-weight: 500; }
  .header-sub { font-size: 12px; color: var(--on-surface-variant); }
  .icon-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--on-surface-variant);
    cursor: pointer;
  }
  .icon-button:hover { background: var(--surface-highest); }
  .icon { flex-shrink: 0; }

  .restart {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 14px 20px 0;
    padding: 12px 12px 12px 16px;
    border-radius: 14px;
    background: var(--tertiary-container);
    color: var(--on-tertiary-container);
  }
  .restart-text { flex: 1; font-size: 13px; line-height: 1.35; }
  .restart-later, .restart-now {
    border: 0;
    border-radius: 20px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
  }
  .restart-later { padding: 8px 10px; background: transparent; color: inherit; opacity: 0.85; }
  .restart-now { padding: 8px 16px; background: var(--on-tertiary-container); color: var(--tertiary-container); }

  .body { flex: 1; padding: 18px 20px 28px; overflow-y: auto; }
  .empty { padding: 60px 20px; text-align: center; color: var(--on-surface-variant); }

  /* groups and cards */
  .group { margin-bottom: 22px; }
  .group-title {
    margin: 0 4px 6px;
    font-size: 12px;
    font-weight: 500;
    letter-spacing: 0.4px;
    color: var(--primary);
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--edge);
    border-radius: 18px;
    overflow: hidden;
  }
  .card + .card { margin-top: 12px; }
  .body > .card { margin-bottom: 12px; }
  .card-status {
    padding: 10px 18px;
    border-top: 1px solid var(--edge);
    font-size: 12px;
    color: var(--on-surface-variant);
  }
  .card-status[data-error] { color: var(--error); }

  /* fields */
  .field { padding: 14px 18px; }
  .card > .field + .field { border-top: 1px solid var(--edge); }
  .field-row { display: flex; align-items: center; gap: 16px; }
  .field-text { flex: 1; min-width: 0; display: flex; flex-direction: column; text-align: left; }
  .label-line { display: flex; align-items: center; gap: 8px; }
  .field-label { font-size: 14px; font-weight: 500; color: var(--on-surface); }
  .field-desc { margin-top: 2px; font-size: 12px; line-height: 1.4; color: var(--on-surface-variant); }
  .field-control { margin-top: 10px; }
  .pill {
    padding: 2px 7px;
    border-radius: 8px;
    background: var(--surface-highest);
    color: var(--on-surface-variant);
    font-size: 10px;
    font-weight: 500;
  }
  .pill.error { background: rgb(242 184 181 / 0.16); color: var(--error); }
  .actions { display: flex; flex-wrap: wrap; gap: 10px; }

  /* plugin cards */
  .plugin { margin-bottom: 12px; }
  .plugin-head { display: flex; align-items: center; gap: 14px; padding: 14px 18px; }
  .plugin-toggle {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--on-surface-variant);
    cursor: pointer;
  }
  .plugin-toggle:disabled { cursor: default; }
  .plugin-body { padding: 4px 18px 6px; border-top: 1px solid var(--edge); background: var(--surface-low); }
  .plugin-body .field { padding: 13px 0; }
  .plugin-body .field + .field { border-top: 1px solid var(--edge); }
  .plugin-group + .plugin-group { border-top: 1px solid var(--edge); }
  .plugin-group-title {
    margin: 14px 0 2px;
    font-size: 12px;
    font-weight: 500;
    letter-spacing: 0.4px;
    color: var(--primary);
  }
  .error-text { margin: 0; padding: 0 18px 14px; font-size: 12px; color: var(--error); }

  /* switch */
  .switch {
    position: relative;
    flex-shrink: 0;
    width: 52px;
    height: 32px;
    padding: 0;
    border: 2px solid var(--outline);
    border-radius: 16px;
    background: var(--surface-highest);
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }
  .switch-thumb {
    position: absolute;
    top: 50%;
    left: 6px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--outline);
    transform: translate(0, -50%);
    transition: transform 0.15s, background 0.15s, width 0.15s, height 0.15s, left 0.15s;
  }
  .switch[aria-checked="true"] { background: var(--primary); border-color: var(--primary); }
  .switch[aria-checked="true"] .switch-thumb {
    left: 4px;
    width: 24px;
    height: 24px;
    background: var(--on-primary);
    transform: translate(20px, -50%);
  }

  /* chips */
  .chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .chip {
    padding: 7px 15px;
    border: 1px solid var(--outline);
    border-radius: 18px;
    background: transparent;
    color: var(--on-surface-variant);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
  }
  .chip:hover { background: var(--surface-highest); }
  .chip[aria-checked="true"] {
    border-color: transparent;
    background: var(--secondary-container);
    color: var(--on-secondary-container);
  }

  /* dropdown, text, stepper */
  .dropdown, .text {
    height: 44px;
    padding: 0 12px;
    border: 1px solid var(--outline);
    border-radius: 8px;
    outline: none;
    background: var(--surface-high);
    color: var(--on-surface);
    font-size: 14px;
  }
  .dropdown { min-width: 220px; }
  .text { width: 100%; }
  .text:focus, .stepper-input:focus { border-color: var(--primary); }
  .stepper { display: inline-flex; align-items: center; gap: 6px; }
  .stepper-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    flex-shrink: 0;
    border: 1px solid var(--outline);
    border-radius: 50%;
    background: transparent;
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
  }
  .stepper-button:hover { background: var(--surface-highest); }
  .stepper-input {
    width: 88px;
    height: 40px;
    border: 1px solid var(--outline);
    border-radius: 8px;
    outline: none;
    background: var(--surface-high);
    color: var(--on-surface);
    text-align: center;
    font-size: 14px;
  }
  .stepper-unit { font-size: 13px; color: var(--on-surface-variant); }

  /* slider */
  .slider-row { display: flex; align-items: center; gap: 16px; width: 100%; }
  .slider-track { position: relative; flex: 1; min-width: 0; height: 44px; }
  .slider-track::before, .slider-track::after {
    content: "";
    position: absolute;
    top: 50%;
    height: 16px;
    border-radius: 999px;
    transform: translateY(-50%);
  }
  .slider-track::before { left: 0; width: max(0px, calc(var(--progress) - 8px)); background: #f7f2fa; }
  .slider-track::after { right: 0; left: min(100%, calc(var(--progress) + 8px)); background: #5f586f; }
  .slider {
    position: relative;
    z-index: 1;
    width: 100%;
    height: 100%;
    margin: 0;
    background: transparent;
    cursor: pointer;
    appearance: none;
  }
  .slider::-webkit-slider-runnable-track { height: 16px; border-radius: 999px; background: transparent; }
  .slider::-webkit-slider-thumb {
    width: 4px;
    height: 44px;
    margin-top: -14px;
    border: 0;
    border-radius: 999px;
    background: #f7f2fa;
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.28);
    appearance: none;
  }
  .slider:hover::-webkit-slider-thumb { width: 6px; }
  .slider:focus-visible { outline-offset: 4px; }
  .slider-value {
    flex-shrink: 0;
    min-width: 64px;
    font-size: 13px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }

  /* buttons */
  .outlined {
    padding: 9px 18px;
    border: 1px solid var(--outline);
    border-radius: 20px;
    background: transparent;
    color: var(--primary);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
  }
  .outlined:hover { background: var(--surface-highest); }
  .shortcut { flex-shrink: 0; min-width: 120px; font-variant-numeric: tabular-nums; }
  .shortcut[data-recording="true"] { border-color: var(--primary); }

  /* about */
  .about-header {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 8px 0 20px;
    text-align: center;
  }
  .about-name { margin-top: 8px; font-size: 22px; font-weight: 600; }
  .about-version, .about-tagline { font-size: 13px; color: var(--on-surface-variant); }
  .about-grid { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 16px 18px; }
  .about-row { display: flex; justify-content: space-between; gap: 16px; font-size: 13px; }
  .about-row dt { color: var(--on-surface-variant); }
  .about-row dd { margin: 0; font-variant-numeric: tabular-nums; }

  /* scrollbars */
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

/** The "Settings" entry in YTM's sidebar (full and mini guide). */
export const entryStyles = css`
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
  button:focus-visible { outline: 2px solid #d0bcff; }
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
