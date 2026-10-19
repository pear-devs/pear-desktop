import { config, definePlugin } from "@pear/sdk";
import { css } from "@pear/sdk/macros" with { type: "macro" };

export default definePlugin({
  id: "blur-nav-bar",
  name: "Blur navigation bar",
  description: "Makes the top bar translucent with a blur behind it.",
  config: {
    blur: config.number(8, { label: "Blur radius", min: 0, max: 32, step: 1, unit: "px" }),
    opacity: config.number(30, { label: "Background opacity", min: 0, max: 100, step: 5, unit: "%" }),
  },
  // Static CSS checked at build time; config flows in through custom properties.
  style: css`
    sel(nav_bar.background),
    sel(browse.header) {
      background: rgb(0 0 0 / var(--pear-nav-opacity, 0.3)) !important;
      backdrop-filter: blur(var(--pear-nav-blur, 8px)) !important;
    }
    sel(tabs) {
      backdrop-filter: blur(var(--pear-nav-blur, 8px)) !important;
    }
    sel(tabs.stuck) {
      background: rgb(0 0 0 / var(--pear-nav-opacity, 0.3)) !important;
    }
    sel(nav_bar.divider) {
      display: none !important;
    }
  `,
  page: {
    runAt: "start",
    start(ctx) {
      // A stylesheet (not documentElement.style): there is no <html> yet at document start.
      ctx.addStyle(variablesCss(ctx.config));
    },
  },
});

function variablesCss(config: { blur: number; opacity: number }) {
  return `:root{--pear-nav-blur:${config.blur}px;--pear-nav-opacity:${config.opacity / 100}}`;
}
