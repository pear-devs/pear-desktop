import { css } from "@pear/sdk/macros" with { type: "macro" };

/** A field's row: label, description, pills. */
export const fieldRows = css`
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
`;

/** Switches, chips, inputs, steppers, lists, sliders and buttons. */
export const controls = css`
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

  .chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .chip {
    padding: 7px 15px;
    border-radius: 18px;
    color: var(--on-surface-variant);
    font-size: 13px;
    font-weight: 500;
  }
  .chip[aria-checked="true"] {
    border-color: transparent;
    background: var(--secondary-container);
    color: var(--on-secondary-container);
  }

  .dropdown, .text { height: 44px; padding: 0 12px; }
  .dropdown { min-width: 220px; }
  .text { width: 100%; }
  .stepper { display: inline-flex; align-items: center; gap: 6px; }
  .list { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
  .list-row { display: flex; align-items: center; gap: 8px; width: 100%; }
  .list-row .icon-button { flex-shrink: 0; font-size: 20px; }
  .stepper-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    flex-shrink: 0;
    border-radius: 50%;
    font-size: 20px;
    line-height: 1;
  }
  .stepper-input { width: 88px; height: 40px; text-align: center; }
  .stepper-unit { font-size: 13px; color: var(--on-surface-variant); }

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
  .slider-track::before { left: 0; width: max(0px, calc(var(--progress) - 8px)); background: var(--slider-active); }
  .slider-track::after { right: 0; left: min(100%, calc(var(--progress) + 8px)); background: var(--slider-inactive); }
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
    background: var(--slider-active);
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

  .outlined {
    padding: 9px 18px;
    border-radius: 20px;
    color: var(--primary);
    font-size: 13px;
    font-weight: 500;
  }
  .shortcut { flex-shrink: 0; min-width: 120px; font-variant-numeric: tabular-nums; }
  .shortcut[data-recording="true"] { border-color: var(--primary); }
`;
