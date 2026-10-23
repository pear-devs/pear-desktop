import { css } from "@pear/sdk/macros" with { type: "macro" };

// Shadow-DOM styles of the lyrics panel.
export const lyricsStyles = css`
  :host {
    display: block;
    --fg: #fff;
    --dim: rgb(255 255 255 / 0.36);
    --faint: rgb(255 255 255 / 0.5);
    --accent: #c6e47a;
    --size: clamp(1.4rem, 1.1vmax, 3rem);
    font-family: "\u0059\u006f\u0075\u0054\u0075\u0062\u0065 Sans", Roboto, "Segoe UI", system-ui, sans-serif;
    color: var(--fg);
    -webkit-font-smoothing: antialiased;
  }
  *, *::before, *::after { box-sizing: border-box; }
  button { font: inherit; color: inherit; }

  /* Lines reach 10px past the edges (hover background); keep the panel from scrolling sideways. */
  .root { position: relative; min-height: 100%; padding-bottom: 40vh; overflow-x: clip; overflow-clip-margin: 10px; }
  /* pear-desktop's line effects (its renderer set these variables per effect). */
  .root {
    --lyrics-font-size: clamp(1.4rem, 1.1vmax, 3rem);
    --lyrics-line-height: 1.4;
    --lyrics-width: 100%;
    --lyrics-padding: 0px;
    --lyrics-animations: none;
    --inactive-weight: 400;
    --inactive-opacity: 0.33;
    --inactive-scale: 1;
    --inactive-offset: 0;
    --active-weight: 700;
    --active-opacity: 1;
    --active-scale: 1;
    --active-offset: 0;
    --glow-color: rgb(255 255 255 / 0.5);
  }
  .root.effect-fancy {
    --lyrics-font-size: 3rem;
    --lyrics-line-height: 1.333;
    --lyrics-padding: 2rem;
    --lyrics-animations: glow var(--line-duration, 2s) forwards, wobble calc(var(--line-duration, 2s) / 2) forwards;
    --inactive-weight: 700;
    --inactive-scale: 0.95;
  }
  .root.effect-scale { --lyrics-width: 83%; --active-scale: 1.2; }
  .root.effect-offset { --active-offset: 5%; }

  /* pear-desktop's lyrics picker. */
  .picker {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: space-around;
    height: 5em;
    margin-bottom: 8px;
    font-size: 14px;
    /* No color of its own, as pear-desktop: themes, album colors and ambient glows show through. */
    backdrop-filter: blur(5px);
    border-bottom: 1px solid rgb(255 255 255 / 0.1);
    transition: transform 325ms ease-in-out;
  }
  .picker[data-hidden] { transform: translateY(-100%); }
  .icon { width: 24px; height: 24px; flex: none; }
  .arrow, .star {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 8px;
    border: 0;
    border-radius: 25%;
    background: none;
    cursor: pointer;
    transition: background-color 0.3s ease;
  }
  .arrow:hover, .star:hover { background-color: hsl(0 0% 100% / 0.1); }
  .star { padding: 4px; color: var(--faint); }
  .star[aria-pressed="true"] { color: var(--fg); }
  .picker-content { display: flex; flex-direction: column; align-items: center; justify-content: space-around; width: 50%; }
  .picker-track { display: flex; width: 100%; overflow: hidden; }
  .picker-item {
    display: flex;
    flex: none;
    width: 100%;
    gap: 6px;
    align-items: center;
    justify-content: center;
    transition: transform 0.25s ease-in-out;
  }
  .picker-item .icon { width: 19px; height: 19px; }
  .picker-item .name { font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .picker-item[data-status="error"] > .icon { color: #ff8a80; }
  .picker-item[data-status="none"] > .icon { color: #f0c000; }
  .spinner {
    width: 16px;
    height: 16px;
    margin: 2px;
    border: 2px solid rgb(255 255 255 / 0.25);
    border-top-color: var(--fg);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .dots { display: flex; gap: 0; margin: 4px 0 0; padding: 0; list-style: none; }
  .dot {
    display: block;
    width: 7px;
    height: 7px;
    margin: 0 4px;
    padding: 0;
    border: 1px solid #6e7c7c7f;
    border-radius: 50%;
    background: black;
    cursor: pointer;
  }
  .dot[aria-current] { background: white; }

  .kaomoji { padding: 32px 0; text-align: center; font-size: 18px; color: var(--faint); user-select: none; }
  .error pre {
    margin: 1em 0 0;
    padding: 0.5em;
    max-width: 100%;
    border-radius: 8px;
    background: rgb(255 255 255 / 0.06);
    font-size: 14px;
    white-space: pre-wrap;
  }
  .error-title { color: #58f000; font-family: serif; }
  .error-detail { color: #f0a500; font-family: monospace; overflow-x: auto; }
  .retry {
    width: 100%;
    margin-top: 1em;
    padding: 8px 16px;
    border: 0;
    border-radius: 18px;
    background: rgb(255 255 255 / 0.1);
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
  }
  .retry:hover { background: rgb(255 255 255 / 0.2); }

  .lines { display: flex; flex-direction: column; gap: 2px; }
  .line {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: var(--lyrics-width);
    padding: calc(var(--lyrics-padding) / 2 + 6px) 10px;
    margin: 0 -10px;
    border-radius: 10px;
    font-size: var(--lyrics-font-size);
    line-height: var(--lyrics-line-height);
    font-weight: var(--inactive-weight);
    cursor: pointer;
    transform-origin: 0 50%;
    scale: var(--inactive-scale);
    translate: var(--inactive-offset);
    color: var(--fg);
    transition:
      scale 0.166s,
      translate 0.3s ease-in-out,
      background 150ms ease;
  }
  .line:hover { background: rgb(255 255 255 / 0.06); }
  .line[data-state="active"] {
    font-weight: var(--active-weight);
    scale: var(--active-scale);
    translate: var(--active-offset);
  }
  /* Each word fades in on its own, a little after the previous one. */
  .line .w {
    display: inline-block;
    white-space: pre-wrap;
    opacity: var(--inactive-opacity);
    transition: opacity 0.33s;
    transition-delay: calc(var(--i, 0) * 0.05s);
  }
  .line[data-state="active"] .w {
    opacity: var(--active-opacity);
    animation: var(--lyrics-animations);
    animation-delay: calc(var(--i, 0) * 0.05s);
  }
  @keyframes glow {
    from { text-shadow: 0 0 1.5rem var(--glow-color); }
    to { text-shadow: 0 0 0 var(--glow-color); }
  }
  @keyframes wobble {
    from { transform: translateY(0); }
    33.33% { transform: translateY(1.75px); }
    66.66% { transform: translateY(-1.75px); }
    to { transform: translateY(0); }
  }
  .time {
    font-size: 11px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    color: var(--faint);
    letter-spacing: 0.02em;
  }
  .text { white-space: pre-wrap; overflow-wrap: anywhere; }
  .romanized {
    color: rgb(255 255 255 / 0.7);
    font-size: 0.7em;
    font-style: italic;
  }

  /* Word sync: each word fills from left to right as it is sung. */
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

  .gap { color: rgb(255 255 255 / 0.33); }
  .gap[data-state="active"] { color: var(--fg); }
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
  .gap-bullets i { font-style: normal; }
  .line[data-state="active"] .gap-bullets i:nth-child(2) { opacity: clamp(0, calc((var(--p, 0) * 3 - 1) * 100), 1); }
  .line[data-state="active"] .gap-bullets i:nth-child(3) { opacity: clamp(0, calc((var(--p, 0) * 3 - 2) * 100), 1); }
  @keyframes breathe { 50% { transform: scale(1.12); } }

  .plain .line {
    cursor: default;
    color: rgb(255 255 255 / 0.86);
    font-size: var(--size);
    font-weight: 500;
    scale: none;
    translate: none;
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
  .source a { color: inherit; text-decoration: underline; }

  .message { padding: 48px 8px; text-align: center; color: var(--faint); }
  .message .glyph { font-size: 40px; line-height: 1; margin-bottom: 12px; opacity: 0.6; }
  .message h2 { margin: 0 0 6px; color: var(--fg); font-size: 18px; font-weight: 600; }
  .message p { margin: 0; font-size: 13px; }
  .message .hint { margin-top: 12px; }

  @media (prefers-reduced-motion: reduce) {
    .line, .line .w, .gap-dots i { transition: none; }
    .line[data-state="active"] .gap-dots,
    .line[data-state="active"] .w { animation: none; }
  }
`;
