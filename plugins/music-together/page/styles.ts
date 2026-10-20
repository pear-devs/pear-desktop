import { css } from "@pear/sdk/macros" with { type: "macro" };

export const launcherStyles = css`
  :host { display: inline-flex; align-items: center; margin-right: 8px; }
  .launcher {
    position: relative;
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: #fff;
    cursor: pointer;
  }
  .launcher:hover, .launcher[aria-expanded="true"] { background: rgb(255 255 255 / 0.1); }
  .launcher:focus-visible { outline: 2px solid #c6e47a; outline-offset: 2px; }
  .launcher[data-active="true"] { color: #c6e47a; }
  .count {
    position: absolute;
    top: 2px;
    right: 0;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 999px;
    background: #c6e47a;
    color: #172000;
    font: 600 10px/16px Roboto, system-ui, sans-serif;
    text-align: center;
  }
`;

export const panelStyles = css`
  :host {
    all: initial;
    --bg: #181818;
    --raised: #242424;
    --hover: #2c2c2c;
    --border: #2f2f2f;
    --text: #f1f1f1;
    --muted: #a8a8a8;
    --faint: #737373;
    --accent: #c6e47a;
    --accent-ink: #172000;
    --danger: #ff8a80;
    font: 14px/1.45 "\u0059\u006f\u0075\u0054\u0075\u0062\u0065 Sans", Roboto, "Segoe UI", system-ui, sans-serif;
    color: var(--text);
  }
  *, *::before, *::after { box-sizing: border-box; }
  button, input { font: inherit; color: inherit; }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .anchor { position: fixed; z-index: 2147482000; }
  .panel {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 14px;
    width: min(360px, calc(100vw - 16px));
    max-height: calc(100vh - 160px);
    overflow-y: auto;
    padding: 18px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 16px;
    box-shadow: 0 18px 60px rgb(0 0 0 / 0.55);
    animation: pop 140ms cubic-bezier(0.2, 0.8, 0.2, 1);
    scrollbar-width: thin;
  }
  @keyframes pop { from { opacity: 0; transform: translateY(-6px) scale(0.98); } }
  .close {
    position: absolute;
    top: 10px;
    right: 10px;
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--faint);
    cursor: pointer;
  }
  .close svg { width: 18px; height: 18px; }
  .close:hover { background: var(--hover); color: var(--text); }

  h2 { margin: 0; font-size: 17px; font-weight: 600; }
  h3 { margin: 0 0 8px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
  p { margin: 0; }
  .muted { color: var(--faint); font-weight: 500; }
  .hint { color: var(--faint); font-size: 12px; }

  .intro { display: flex; gap: 12px; padding-right: 24px; }
  .intro p { margin-top: 2px; color: var(--muted); font-size: 13px; }
  .badge-icon {
    flex: none;
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 12px;
    background: rgb(198 228 122 / 0.12);
    color: var(--accent);
  }

  .field { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--muted); }
  input {
    width: 100%;
    min-width: 0;
    padding: 9px 12px;
    background: #0f0f0f;
    border: 1px solid var(--border);
    border-radius: 10px;
    outline: none;
    font-size: 14px;
    color: var(--text);
  }
  input:focus { border-color: var(--accent); }
  input[aria-invalid="true"] { border-color: var(--danger); }
  .code-input { font-family: ui-monospace, "Roboto Mono", monospace; letter-spacing: 0.12em; text-transform: uppercase; }
  .row { display: flex; gap: 8px; }

  .button {
    flex: none;
    padding: 8px 16px;
    background: var(--raised);
    border: 1px solid var(--border);
    border-radius: 999px;
    cursor: pointer;
    font-weight: 500;
    white-space: nowrap;
  }
  .button:hover:not(:disabled) { background: var(--hover); }
  .button:disabled { opacity: 0.45; cursor: default; }
  .button.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); font-weight: 600; }
  .button.primary:hover { background: #d4ee8f; }
  .button.danger { color: var(--danger); }
  .button.small { padding: 4px 12px; font-size: 13px; }
  .button.wide { width: 100%; padding: 10px 16px; }

  .divider { display: flex; align-items: center; gap: 10px; color: var(--faint); font-size: 12px; }
  .divider::before, .divider::after { content: ""; flex: 1; height: 1px; background: var(--border); }
  .message { padding: 8px 12px; border-radius: 10px; background: rgb(255 138 128 / 0.1); color: var(--danger); font-size: 13px; }

  .busy { display: flex; align-items: center; gap: 12px; padding: 24px 4px; color: var(--muted); }
  .spinner {
    width: 18px;
    height: 18px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 700ms linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .status { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-right: 32px; }
  .live { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; }
  .live i { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 4px rgb(198 228 122 / 0.18); animation: glow 2s ease-in-out infinite; }
  .live.guest i { background: #8ab4f8; box-shadow: 0 0 0 4px rgb(138 180 248 / 0.18); }
  @keyframes glow { 50% { box-shadow: 0 0 0 7px rgb(198 228 122 / 0.05); } }

  .code-card { display: flex; flex-direction: column; gap: 6px; padding: 14px; border-radius: 12px; background: var(--raised); }
  .code-card .label { font-size: 12px; color: var(--muted); }
  .code-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  code { font: 600 28px/1.1 ui-monospace, "Roboto Mono", monospace; letter-spacing: 0.08em; color: var(--text); user-select: all; }

  .segmented { display: grid; grid-template-columns: repeat(3, 1fr); padding: 3px; gap: 3px; border-radius: 10px; background: #0f0f0f; border: 1px solid var(--border); }
  .segmented button { padding: 6px 4px; border: 0; border-radius: 7px; background: transparent; color: var(--muted); font-size: 12px; font-weight: 500; cursor: pointer; }
  .segmented button:hover { color: var(--text); }
  .segmented button[aria-checked="true"] { background: var(--raised); color: var(--text); box-shadow: 0 1px 2px rgb(0 0 0 / 0.4); }
  .segmented + .hint { margin-top: 6px; }

  .people { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; list-style: none; }
  .people li { display: flex; align-items: center; gap: 10px; }
  .avatar { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; color: #fff; font-size: 11px; font-weight: 600; }
  .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tag { padding: 0 7px; border-radius: 999px; background: var(--raised); color: var(--muted); font-size: 11px; }
  .tag.host { background: rgb(198 228 122 / 0.14); color: var(--accent); }

  .queue { display: flex; flex-direction: column; gap: 4px; margin: 0; padding: 0; list-style: none; }
  .queue li { display: flex; align-items: center; gap: 10px; padding: 6px; margin: 0 -6px; border-radius: 10px; }
  .queue li:hover { background: var(--raised); }
  .queue img { flex: none; width: 40px; height: 40px; border-radius: 6px; object-fit: cover; background: var(--raised); }
  .meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .meta strong, .meta span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta strong { font-weight: 500; font-size: 13px; }
  .meta span { color: var(--faint); font-size: 12px; }
  .actions { display: flex; gap: 2px; opacity: 0.6; }
  .queue li:hover .actions, .actions:focus-within { opacity: 1; }
  .icon { display: grid; place-items: center; width: 30px; height: 30px; padding: 0; border: 0; border-radius: 50%; background: transparent; cursor: pointer; color: var(--muted); }
  .icon svg { width: 18px; height: 18px; }
  .icon:hover { background: var(--hover); color: var(--text); }

  .now { display: flex; align-items: center; gap: 10px; padding: 10px; border-radius: 12px; background: var(--raised); }
  .now img { width: 40px; height: 40px; border-radius: 6px; object-fit: cover; }
  .now div { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .now strong, .now div span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .now strong { font-size: 13px; font-weight: 500; }
  .now div span { color: var(--faint); font-size: 12px; }
  .sync { flex: none; padding: 2px 8px; border-radius: 999px; font-size: 11px; background: rgb(255 209 128 / 0.12); color: #ffd180; }
  .sync[data-sync="true"] { background: rgb(198 228 122 / 0.12); color: var(--accent); }

  .toasts {
    position: fixed;
    left: 50%;
    bottom: 96px;
    z-index: 2147482001;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    transform: translateX(-50%);
    pointer-events: none;
  }
  .toast {
    padding: 10px 16px;
    border-radius: 10px;
    background: #f1f1f1;
    color: #0f0f0f;
    font-size: 13px;
    font-weight: 500;
    box-shadow: 0 8px 30px rgb(0 0 0 / 0.45);
    animation: toast 180ms ease-out;
  }
  @keyframes toast { from { opacity: 0; transform: translateY(8px); } }
  .host-id {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
    font: 500 12px ui-monospace, monospace;
  }
`;
