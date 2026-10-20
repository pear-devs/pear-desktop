import { css } from "@pear/sdk/macros" with { type: "macro" };

/** The scrim, the dialog (or the whole window), its header, the restart banner and the body. */
export const layout = css`
  .root {
    position: fixed;
    inset: 0;
    /* Above everything YTM stacks on its page. Not a custom property: lightningcss rounds those to 2147480000. */
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
    border-radius: 50%;
    color: var(--on-surface-variant);
  }
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
  .restart-later, .restart-now { border-radius: 20px; font-size: 13px; font-weight: 500; }
  .restart-later { padding: 8px 10px; color: inherit; opacity: 0.85; }
  .restart-now { padding: 8px 16px; background: var(--on-tertiary-container); color: var(--tertiary-container); }

  .body { flex: 1; padding: 18px 20px 28px; overflow-y: auto; overscroll-behavior: contain; }
  .empty { padding: 60px 20px; text-align: center; color: var(--on-surface-variant); }
`;
