import { css } from "@pear/sdk/macros" with { type: "macro" };

/** Material 3's dark colour roles, for both shadow roots. */
export const palette = css`
  :host {
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
    --slider-active: #f7f2fa;
    --slider-inactive: #5f586f;
  }
`;
