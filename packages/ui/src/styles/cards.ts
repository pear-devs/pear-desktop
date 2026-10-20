import { css } from "@pear/sdk/macros" with { type: "macro" };

/** Groups and cards, plugin cards, pills and status lines. */
export const cards = css`
  .group { margin-bottom: 22px; }
  .group-title, .plugin-group-title {
    font-size: 12px;
    font-weight: 500;
    letter-spacing: 0.4px;
    color: var(--primary);
  }
  .group-title { margin: 0 4px 6px; }
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
`;

export const pluginCards = css`
  .plugin { margin-bottom: 12px; }
  .plugin-head { display: flex; align-items: center; gap: 14px; padding: 14px 18px; }
  .plugin-toggle {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 0;
    color: var(--on-surface-variant);
  }
  .plugin-toggle:disabled { cursor: default; }
  .plugin-body { padding: 4px 18px 6px; border-top: 1px solid var(--edge); background: var(--surface-low); }
  .plugin-body .field { padding: 13px 0; }
  .plugin-body .field + .field { border-top: 1px solid var(--edge); }
  .plugin-group + .plugin-group { border-top: 1px solid var(--edge); }
  .plugin-group-title { margin: 14px 0 2px; }
  .error-text, .status-text { margin: 0; padding: 0 18px 14px; font-size: 12px; }
  .error-text { color: var(--error); }
  .status-text { color: var(--on-surface-variant); }

  /* The site's feature flags: many short rows. */
  .site-flag { padding: 6px 18px; }
  .site-flag .field-label { font: 400 12px/1.4 ui-monospace, monospace; overflow-wrap: anywhere; }
  .site-flag button.pill { border: 0; cursor: pointer; }
`;
