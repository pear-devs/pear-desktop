import { css } from "@pear/sdk/macros" with { type: "macro" };

// Shadow-DOM styles of the lyrics panel.
export const lyricsStyles = css`
  :host {
    display: block;
    --fg: #fff;
    --dim: rgb(255 255 255 / 0.36);
    --faint: rgb(255 255 255 / 0.5);
    --accent: #c6e47a;
    --size: clamp(20px, 1.6vw + 6px, 30px);
    --inactive-weight: 700;
    --active-weight: 700;
    --inactive-scale: 0.96;
    --active-scale: 1;
    --active-shift: 0px;
    --inactive-blur: 0px;
    font-family: "\u0059\u006f\u0075\u0054\u0075\u0062\u0065 Sans", Roboto, "Segoe UI", system-ui, sans-serif;
    color: var(--fg);
    -webkit-font-smoothing: antialiased;
  }
  *, *::before, *::after { box-sizing: border-box; }
  button { font: inherit; color: inherit; }

  .root { position: relative; min-height: 100%; padding-bottom: 40vh; }
  .root.effect-scale { --inactive-weight: 500; --active-weight: 700; --inactive-scale: 1; --active-scale: 1.06; }
  .root.effect-offset { --inactive-weight: 500; --active-weight: 700; --inactive-scale: 1; --active-shift: 14px; }
  .root.effect-focus { --inactive-weight: 600; --active-weight: 700; --inactive-scale: 1; --inactive-blur: 1.6px; }

  .picker {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 12px 0;
    margin-bottom: 4px;
    background: var(--panel-bg, #030303);
    box-shadow: 0 10px 12px -2px var(--panel-bg, #030303);
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 9px;
    border: 1px solid rgb(255 255 255 / 0.12);
    border-radius: 999px;
    background: rgb(255 255 255 / 0.04);
    color: var(--faint);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
  }
  .chip:hover:not(:disabled, [aria-checked="true"]) { background: rgb(255 255 255 / 0.1); color: var(--fg); }
  .chip:disabled { cursor: default; opacity: 0.55; }
  .chip[aria-checked="true"] { background: var(--fg); border-color: var(--fg); color: #0f0f0f; opacity: 1; }
  .chip .kind { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; opacity: 0.7; }
  .chip .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: 0.5; }
  .chip[data-status="found"] .dot { background: var(--accent); opacity: 1; }
  .chip[aria-checked="true"] .dot { background: #4b6b00; }
  .chip[data-status="error"] .dot { background: #ff8a80; opacity: 1; }
  .chip[data-status="loading"] .dot { animation: pulse 900ms ease-in-out infinite alternate; }
  @keyframes pulse { from { opacity: 0.2; } to { opacity: 0.9; } }

  .lines { display: flex; flex-direction: column; gap: 2px; }
  .line {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 10px;
    margin: 0 -10px;
    border-radius: 10px;
    font-size: var(--size);
    line-height: 1.28;
    font-weight: var(--inactive-weight);
    letter-spacing: -0.01em;
    cursor: pointer;
    transform-origin: left center;
    transform: translateX(0) scale(var(--inactive-scale));
    color: var(--dim);
    filter: blur(var(--inactive-blur));
    transition:
      transform 380ms cubic-bezier(0.2, 0.8, 0.2, 1),
      color 300ms ease,
      filter 300ms ease,
      background 150ms ease;
  }
  .line:hover { background: rgb(255 255 255 / 0.06); filter: none; }
  .line[data-state="past"] { color: rgb(255 255 255 / 0.28); }
  .line[data-state="active"] {
    color: var(--fg);
    font-weight: var(--active-weight);
    transform: translateX(var(--active-shift)) scale(var(--active-scale));
    filter: none;
  }
  .effect-fancy .line[data-state="active"] { text-shadow: 0 0 18px rgb(255 255 255 / 0.35); }
  .time {
    font-size: 11px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    color: var(--faint);
    letter-spacing: 0.02em;
  }
  .text { white-space: pre-wrap; overflow-wrap: anywhere; }
  .romanized {
    font-size: 0.62em;
    font-weight: 500;
    font-style: italic;
    opacity: 0.75;
  }

  /* Word sync: each word fills from left to right as it is sung. */
  .line.has-words[data-state="active"] { color: var(--dim); text-shadow: none; }
  .line.has-words[data-state="active"] .word {
    background: linear-gradient(
      90deg,
      var(--fg) calc(var(--p, 0) * 100% - 4%),
      var(--dim) calc(var(--p, 0) * 100% + 4%)
    );
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  .line.has-words[data-state="past"] .word { color: rgb(255 255 255 / 0.28); }

  .gap .text { font-size: 0.8em; letter-spacing: 0.1em; }
  .gap-dots { display: inline-flex; gap: 8px; padding: 6px 0; }
  .gap-dots i {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: currentColor;
    opacity: 0.35;
    transition: opacity 200ms ease, transform 200ms ease;
  }
  .line[data-state="active"] .gap-dots i:nth-child(1) { opacity: clamp(0.35, calc(var(--p, 0) * 3), 1); }
  .line[data-state="active"] .gap-dots i:nth-child(2) { opacity: clamp(0.35, calc(var(--p, 0) * 3 - 1), 1); }
  .line[data-state="active"] .gap-dots i:nth-child(3) { opacity: clamp(0.35, calc(var(--p, 0) * 3 - 2), 1); }
  .line[data-state="active"] .gap-dots { animation: breathe 2.4s ease-in-out infinite; }
  @keyframes breathe { 50% { transform: scale(1.12); } }

  .plain .line {
    cursor: default;
    color: rgb(255 255 255 / 0.86);
    font-size: calc(var(--size) * 0.72);
    font-weight: 500;
    transform: none;
    filter: none;
    padding-block: 2px;
  }
  .plain .line:hover { background: none; }
  .plain .line.section { color: var(--faint); font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; padding-top: 8px; }
  .plain .spacer { height: 14px; }

  .resume {
    position: sticky;
    bottom: 20px;
    display: block;
    margin: 16px auto 0;
    padding: 8px 16px;
    border: 0;
    border-radius: 999px;
    background: var(--fg);
    color: #0f0f0f;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 6px 24px rgb(0 0 0 / 0.5);
    animation: rise 160ms ease-out;
  }
  @keyframes rise { from { opacity: 0; transform: translateY(8px); } }

  .source { margin-top: 28px; color: var(--faint); font-size: 12px; }

  .skeleton { display: flex; flex-direction: column; gap: 18px; padding-top: 8px; }
  .skeleton span {
    height: calc(var(--size) * 0.8);
    border-radius: 8px;
    background: linear-gradient(90deg, rgb(255 255 255 / 0.05), rgb(255 255 255 / 0.12), rgb(255 255 255 / 0.05));
    background-size: 200% 100%;
    animation: shimmer 1.4s ease-in-out infinite;
  }
  @keyframes shimmer { from { background-position: 100% 0; } to { background-position: -100% 0; } }

  .message { padding: 48px 8px; text-align: center; color: var(--faint); }
  .message .glyph { font-size: 40px; line-height: 1; margin-bottom: 12px; opacity: 0.6; }
  .message h2 { margin: 0 0 6px; color: var(--fg); font-size: 18px; font-weight: 600; }
  .message p { margin: 0; font-size: 13px; }
  .message .hint { margin-top: 12px; }

  @media (prefers-reduced-motion: reduce) {
    .line, .gap-dots i { transition: none; }
    .line[data-state="active"] .gap-dots { animation: none; }
  }
`;
