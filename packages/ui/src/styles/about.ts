import { css } from "@pear/sdk/macros" with { type: "macro" };

export const about = css`
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
`;
