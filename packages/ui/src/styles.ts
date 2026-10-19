import { css } from "@pear/sdk/macros" with { type: "macro" };

// Shadow-DOM styles for the settings overlay, validated and minified at build time.
export const overlayStyles = css`
  :host {
    all: initial;
    --bg: #0f0f0f;
    --panel: #181818;
    --raised: #222;
    --hover: #2a2a2a;
    --border: #2e2e2e;
    --text: #f1f1f1;
    --muted: #a8a8a8;
    --faint: #6f6f6f;
    --accent: #c6e47a;
    --accent-ink: #172000;
    --danger: #ff8a80;
    --warn: #ffd180;
    font: 14px/1.45 "\u0059\u006f\u0075\u0054\u0075\u0062\u0065 Sans", Roboto, "Segoe UI", system-ui, sans-serif;
    color: var(--text);
  }
  *, *::before, *::after { box-sizing: border-box; }
  button, input, select { font: inherit; color: inherit; }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 2147483000;
    display: grid;
    place-items: center;
    background: rgb(0 0 0 / 0.62);
    backdrop-filter: blur(6px);
    animation: fade 120ms ease-out;
  }
  .dialog {
    width: min(880px, calc(100vw - 32px));
    height: min(680px, calc(100vh - 32px));
    display: flex;
    flex-direction: column;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 16px;
    box-shadow: 0 24px 80px rgb(0 0 0 / 0.6);
    overflow: hidden;
    animation: rise 160ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  @keyframes fade { from { opacity: 0; } }
  @keyframes rise { from { opacity: 0; transform: translateY(12px) scale(0.98); } }

  header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border);
  }
  .brand { display: flex; align-items: center; gap: 10px; margin-right: auto; }
  .brand h1 { margin: 0; font-size: 18px; font-weight: 600; letter-spacing: 0.01em; }
  .brand span { color: var(--muted); font-size: 13px; }
  .search {
    width: min(280px, 40vw);
    padding: 8px 12px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 999px;
    outline: none;
  }
  .search:focus { border-color: var(--accent); }
  .icon-button {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    padding: 0;
    background: transparent;
    border: 0;
    border-radius: 50%;
    cursor: pointer;
    color: var(--muted);
  }
  .icon-button:hover { background: var(--hover); color: var(--text); }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 20px;
    border-bottom: 1px solid var(--border);
  }
  .chip {
    padding: 4px 12px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 999px;
    cursor: pointer;
    color: var(--muted);
  }
  .chip[aria-pressed="true"] { background: var(--text); color: var(--bg); border-color: var(--text); }
  .count { margin-left: auto; color: var(--faint); font-size: 12px; }

  .banner {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 20px;
    background: #2a2412;
    color: var(--warn);
    border-bottom: 1px solid #3d3418;
  }
  .banner button { margin-left: auto; }

  .list { flex: 1; overflow-y: auto; padding: 8px 12px 16px; }
  .empty { padding: 48px; text-align: center; color: var(--muted); }

  .plugin { border-radius: 12px; }
  .plugin + .plugin { margin-top: 2px; }
  .plugin[data-open="true"] { background: var(--panel); }
  .plugin-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    border-radius: 12px;
  }
  .plugin-row:hover { background: var(--panel); }
  .plugin-main { flex: 1; min-width: 0; }
  .plugin-name { display: flex; align-items: center; gap: 8px; font-weight: 500; }
  .plugin-description {
    margin-top: 2px;
    color: var(--muted);
    font-size: 13px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .badge {
    padding: 1px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 500;
    background: var(--raised);
    color: var(--muted);
  }
  .badge.error { background: #3a1c1a; color: var(--danger); }
  .error-text { margin: 0 12px 10px 12px; color: var(--danger); font-size: 12px; }

  .expand { transition: transform 120ms ease; }
  .expand[aria-expanded="true"] { transform: rotate(180deg); }

  .fields { padding: 4px 12px 12px; }
  .field {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 10px 12px;
    border-top: 1px solid var(--border);
  }
  .field-label { flex: 1; min-width: 0; }
  .field-label small { display: block; color: var(--muted); font-size: 12px; }
  .field input[type="text"],
  .field input[type="password"],
  .field input[type="number"],
  .field select {
    width: 220px;
    padding: 6px 10px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    outline: none;
  }
  .field input:focus, .field select:focus { border-color: var(--accent); }
  .range { display: flex; align-items: center; gap: 10px; }
  .range input { width: 160px; accent-color: var(--accent); }
  .range output { min-width: 56px; text-align: right; color: var(--muted); font-variant-numeric: tabular-nums; }

  .switch {
    position: relative;
    flex: none;
    width: 40px;
    height: 22px;
    padding: 0;
    background: #3a3a3a;
    border: 0;
    border-radius: 999px;
    cursor: pointer;
    transition: background 120ms ease;
  }
  .switch::after {
    content: "";
    position: absolute;
    top: 3px;
    left: 3px;
    width: 16px;
    height: 16px;
    background: #d0d0d0;
    border-radius: 50%;
    transition: transform 140ms ease, background 140ms ease;
  }
  .switch[aria-checked="true"] { background: var(--accent); }
  .switch[aria-checked="true"]::after { transform: translateX(18px); background: var(--accent-ink); }

  .button {
    padding: 6px 14px;
    background: var(--raised);
    border: 1px solid var(--border);
    border-radius: 999px;
    cursor: pointer;
  }
  .button:hover { background: var(--hover); }
  .button.primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); font-weight: 600; }
  .shortcut { min-width: 140px; font-family: ui-monospace, monospace; font-size: 12px; }
  .shortcut[data-recording="true"] { border-color: var(--accent); color: var(--accent); }

  footer {
    display: flex;
    gap: 16px;
    padding: 10px 20px;
    border-top: 1px solid var(--border);
    color: var(--faint);
    font-size: 12px;
  }
  kbd {
    padding: 0 5px;
    border: 1px solid var(--border);
    border-bottom-width: 2px;
    border-radius: 4px;
    font: 11px ui-monospace, monospace;
  }

  @media (max-width: 560px) {
    .dialog { width: 100vw; height: 100vh; border-radius: 0; }
    .field { flex-wrap: wrap; }
    .field input[type="text"], .field input[type="password"], .field select { width: 100%; }
  }
`;

// Styles for the launcher button that lives in YTM's nav bar (its own shadow root).
export const launcherStyles = css`
  :host { display: inline-flex; align-items: center; margin: 0 4px; }
  button {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    padding: 0;
    background: transparent;
    border: 0;
    border-radius: 50%;
    color: #fff;
    cursor: pointer;
  }
  button:hover { background: rgb(255 255 255 / 0.1); }
  button:focus-visible { outline: 2px solid #c6e47a; }
`;
